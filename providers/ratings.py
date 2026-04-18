import requests


MDBLIST_PROVIDER_TO_API = {
    "mdblist_trakt": "trakt",
    "mdblist_tmdb": "tmdb",
    "mdblist_letterboxd": "letterboxd",
    "mdblist_tomatoes": "tomatoes",
    "mdblist_audience": "audience",
    "mdblist_metacritic": "metacritic",
}

RATING_LOGOS = {
    "tmdb": "tmdblogo.png",
    "imdb_api": "imdb_logo_2016.svg",
    "mdblist_trakt": "mdblist_trakt.svg",
    "mdblist_tmdb": "mdblist_tmdb.svg",
    "mdblist_letterboxd": "mdblist_letterboxd.svg",
    "mdblist_tomatoes": "mdblist_tomatoes.svg",
    "mdblist_audience": "mdblist_audience.png",
    "mdblist_metacritic": "mdblist_metacritic.png",
}


def apply_configured_rating(metadata, config):
    enriched = dict(metadata or {})
    provider = (config.get("ratings", {}) or {}).get("default_provider", "tmdb")
    enriched["rating_provider"] = provider
    enriched["rating_logo"] = RATING_LOGOS.get(provider, "tmdblogo.png")

    if provider == "tmdb":
        return enriched

    imdb_id = find_imdb_id(enriched)
    if not imdb_id:
        return enriched

    rating = None
    if provider.startswith("mdblist_"):
        rating = fetch_mdblist_rating(imdb_id, provider, enriched, config)
    elif provider == "imdb_api":
        rating = fetch_custom_imdb_rating(imdb_id, config)

    if rating is not None:
        enriched["rating"] = rating
    return enriched


def find_imdb_id(metadata):
    if metadata.get("imdb_id"):
        return metadata["imdb_id"]
    provider_ids = metadata.get("provider_ids") or {}
    for key in ("Imdb", "imdb", "imdb_id"):
        if provider_ids.get(key):
            return provider_ids[key]
    return None


def fetch_mdblist_rating(imdb_id, provider, metadata, config):
    mdblist = config.get("mdblist", {}) or {}
    if not mdblist.get("enabled") or not mdblist.get("api_key"):
        return None
    rating_type = MDBLIST_PROVIDER_TO_API.get(provider)
    if not rating_type:
        return None
    media_type = normalize_mdblist_media_type(metadata)
    url = f"https://api.mdblist.com/rating/{media_type}/{rating_type}?apikey={mdblist['api_key']}"
    response = requests.post(url, json={"ids": [imdb_id], "provider": "imdb"}, timeout=10)
    response.raise_for_status()
    first = (response.json().get("ratings") or [{}])[0]
    return first.get("rating")


def fetch_custom_imdb_rating(imdb_id, config):
    imdb = config.get("imdb_ratings", {}) or {}
    if not imdb.get("enabled") or not imdb.get("base_url") or not imdb.get("api_key"):
        return None
    api_key = normalize_api_key(imdb["api_key"])
    if not api_key:
        return None
    base_url = str(imdb["base_url"]).rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    response = requests.get(
        f"{base_url}/ratings/{imdb_id}",
        headers={"X-API-Key": api_key},
        timeout=10,
    )
    response.raise_for_status()
    return response.json().get("averageRating")


def normalize_api_key(raw):
    key = str(raw or "").strip()
    if key.lower().startswith("bearer "):
        key = key[7:].strip()
    return key


def normalize_mdblist_media_type(metadata):
    raw = str(metadata.get("media_type") or metadata.get("type") or metadata.get("source_type") or "").lower()
    if raw in ("movie", "film"):
        return "movie"
    return "show"
