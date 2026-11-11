from planning import AIRPORTS, source
from providers import ProviderUnavailable, get_json
from state import TravelState


def weather_node(state: TravelState):
    city, latitude, longitude = AIRPORTS[state["destination"]]
    try:
        data = get_json("https://api.open-meteo.com/v1/forecast", params={"latitude": latitude, "longitude": longitude, "current_weather": "true"})
        weather = data.get("current_weather") or {}
        if weather.get("temperature") is None or weather.get("windspeed") is None:
            raise ProviderUnavailable()
        return {
            "weather_summary": f"Current weather near {city} airport: {weather['temperature']}°C, wind {weather['windspeed']} km/h. This is not a forecast for your trip dates.",
            "weather_source": source("Open-Meteo", "https://open-meteo.com/", f"{state['destination']}:{weather.get('time')}", "current_weather"),
        }
    except ProviderUnavailable:
        return {"weather_summary": "Weather unavailable. Check a forecast closer to departure.", "warnings": ["Current weather could not be retrieved. No travel-date forecast has been inferred."]}
