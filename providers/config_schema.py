from copy import deepcopy


REMOVED_PROVIDER_KEYS = {"jellyfin", "plex", "radarr", "sonarr", "jellyseerr"}

TRAKT_BUILT_IN_CATALOGS = [
    "trakt_trending_movies",
    "trakt_trending_shows",
    "trakt_popular_movies",
    "trakt_popular_shows",
    "trakt_recommended_movies",
    "trakt_recommended_shows",
    "trakt_calendar_next_7_days",
]


def default_config():
    return {
        "general": {"overwrite_existing": False, "timezone_offset": 1},
        "providers": {
            "sources": ["tmdb", "trakt"],
            "metadata": ["tmdb", "tvdb"],
            "ratings": ["tmdb", "mdblist", "imdb_ratings"],
        },
        "metadata": {"movie_provider": "tmdb", "tv_provider": "tmdb"},
        "tmdb": {"api_key": "", "language": "de-DE"},
        "tvdb": {
            "enabled": False,
            "base_url": "https://api4.thetvdb.com/v4",
            "api_key": "",
            "pin": "",
            "language": "en",
        },
        "mdblist": {
            "enabled": False,
            "api_key": "",
            "show_trakt": True,
            "show_tmdb": True,
            "show_letterboxd": True,
            "show_tomatoes": True,
            "show_audience": True,
            "show_metacritic": True,
        },
        "imdb_ratings": {"enabled": False, "base_url": "", "api_key": ""},
        "ratings": {"default_provider": "tmdb"},
        "trakt": {
            "api_key": "",
            "client_id": "",
            "client_secret": "",
            "username": "",
            "listname": "",
            "access_token": "",
            "refresh_token": "",
            "expires_at": 0,
            "device_code": "",
            "user_code": "",
            "verification_url": "",
            "poll_interval": 5,
            "device_expires_at": 0,
            "catalogs": {
                "enabled": ["trakt_trending_movies", "trakt_trending_shows"],
                "selected_popular_list_keys": [],
            },
        },
        "editor": {"resolution": "1080"},
        "cron": {"enabled": False, "start_time": "00:00", "frequency": "1"},
        "cron_jobs": [],
    }


def merge_config(loaded):
    merged = deepcopy(default_config())
    if not isinstance(loaded, dict):
        return merged

    for key, value in loaded.items():
        if key in REMOVED_PROVIDER_KEYS:
            continue
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key].update(value)
        else:
            merged[key] = value

    trakt = merged.setdefault("trakt", {})
    if trakt.get("api_key") and not trakt.get("client_id"):
        trakt["client_id"] = trakt["api_key"]
    if trakt.get("client_id") and not trakt.get("api_key"):
        trakt["api_key"] = trakt["client_id"]

    catalogs = trakt.setdefault("catalogs", {})
    catalogs.setdefault("enabled", ["trakt_trending_movies", "trakt_trending_shows"])
    catalogs.setdefault("selected_popular_list_keys", [])

    return merged
