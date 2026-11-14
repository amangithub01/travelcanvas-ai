import os
from threading import BoundedSemaphore
from urllib.parse import urlencode, urlparse

import requests

from planning import safe_url, source
from staging import ControlError, get_controls, reserve_provider


class ProviderUnavailable(Exception):
    pass


_provider_slots = BoundedSemaphore(4)


def get_json(url, *, params=None, headers=None):
    if not _provider_slots.acquire(timeout=15):
        raise ProviderUnavailable("Provider capacity is busy. Try again later.")
    try:
        hosts = {
            "serpapi.com": "serpapi", "api.open-meteo.com": "weather",
            "api.frankfurter.dev": "exchange", "api.foursquare.com": "foursquare",
        }
        provider = hosts.get(urlparse(url).hostname)
        if provider:
            reserve_provider(provider)
        elif get_controls().settings.mode == "staging":
            raise ControlError("This provider is not permitted by staging controls.")
        return _request_json(url, params=params, headers=headers)
    except ControlError as error:
        raise ProviderUnavailable(str(error)) from None
    finally:
        _provider_slots.release()


def _request_json(url, *, params=None, headers=None):
    try:
        response = requests.get(url, params=params, headers=headers, timeout=(3, 10))
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or data.get("error") or data.get("errors"):
            raise ProviderUnavailable("Provider returned an error.")
        return data
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            message = "Provider rejected access. Check the API key and account permissions."
        elif status == 429:
            message = "Provider quota or rate limit reached. Check the account before retrying."
        else:
            message = "Provider returned an HTTP error. Try again later."
        raise ProviderUnavailable(message) from None
    except requests.Timeout:
        raise ProviderUnavailable("Provider request timed out. Try again later.") from None
    except (requests.RequestException, ValueError):
        raise ProviderUnavailable("Provider could not be reached or returned invalid data.") from None


def local_places(city, query, limit):
    data = get_json("https://serpapi.com/search", params={
        "engine": "google_local", "q": f"{query} in {city}", "hl": "en",
        "api_key": os.environ["SERPAPI_API_KEY"],
    })
    results = data.get("local_results", [])
    if not isinstance(results, list):
        raise ProviderUnavailable("Provider returned unsupported place results.")
    places, seen = [], set()
    for place in results[:20]:
        if not isinstance(place, dict):
            continue
        name, address = place.get("title"), place.get("address")
        if address is None:
            address = ""
        if not isinstance(name, str) or not name.strip() or not isinstance(address, str):
            continue
        identity = str(place.get("place_id") or f"{name.strip().casefold()}:{address.casefold()}")
        if identity in seen:
            continue
        seen.add(identity)
        url = safe_url(place.get("website")) or "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": f"{name} {address} {city}"})
        evidence = source("Google Local via SerpAPI", url, f"{city}:{identity}")
        places.append({"id": evidence["id"], "name": name.strip()[:200], "address": address[:2000], "source": evidence})
        if len(places) >= limit:
            break
    return places
