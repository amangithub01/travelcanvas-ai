import argparse
import json
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description="Check staging readiness and anonymous rejection without a live travel search.")
    parser.add_argument("--api", default="http://127.0.0.1:8080/api")
    args = parser.parse_args()
    base = args.api.rstrip("/")
    try:
        with urlopen(f"{base}/ready", timeout=10) as response:
            ready = json.load(response)
        if ready.get("mode") != "staging" or ready.get("status") != "ready":
            raise ValueError("The target is not a ready staging API. No plan request was sent.")
        start = datetime.now(timezone.utc).date() + timedelta(days=30)
        request = {
            "origin": "BOM", "destination": "DEL", "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=2)).isoformat(), "max_price": 50000, "currency": "INR",
        }
        try:
            with urlopen(Request(f"{base}/plan-trip", data=json.dumps(request).encode(),
                                 headers={"Content-Type": "application/json"}), timeout=10):
                raise ValueError("Anonymous planning was accepted. Do not release this staging deployment.")
        except HTTPError as error:
            if error.code != 401:
                raise ValueError(f"Expected anonymous rejection HTTP 401, received {error.code}.") from None
        print("PASS: staging readiness and anonymous rejection. Authenticated travel-provider checks remain separate.")
        return 0
    except (HTTPError, URLError, ValueError, TimeoutError):
        print("FAIL: staging probe did not pass. Check readiness, staging mode, authentication, and operator pause state.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
