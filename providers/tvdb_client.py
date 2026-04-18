import time

import requests


TVDB_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
TVDB_TOKEN_REFRESH_SKEW_SECONDS = 24 * 60 * 60


class TVDBClient:
    def __init__(self, config, session=None, now=None):
        self.config = config or {}
        self.session = session or requests.Session()
        self.now = now or time.time
        self._token = None
        self._token_expires_at = 0

    @property
    def base_url(self):
        return str(self.config.get("base_url") or "https://api4.thetvdb.com/v4").rstrip("/")

    @property
    def language(self):
        return str(self.config.get("language") or "en").split("-")[0].lower()

    def enabled(self):
        return bool(self.config.get("enabled") and self.config.get("api_key"))

    def bearer_token(self):
        if not self.enabled():
            return None

        refresh_after = self.now() + TVDB_TOKEN_REFRESH_SKEW_SECONDS
        if self._token and self._token_expires_at > refresh_after:
            return self._token

        payload = {"apikey": self.config.get("api_key", "").strip()}
        pin = self.config.get("pin", "").strip()
        if pin:
            payload["pin"] = pin

        response = self.session.post(f"{self.base_url}/login", json=payload, timeout=10)
        response.raise_for_status()
        token = response.json().get("data", {}).get("token")
        if not token:
            return None

        self._token = f"Bearer {token}"
        self._token_expires_at = self.now() + TVDB_TOKEN_TTL_SECONDS
        return self._token

    def fetch_series_details(self, tvdb_id):
        auth = self.bearer_token()
        if not auth:
            return {}

        response = self.session.get(
            f"{self.base_url}/series/{int(tvdb_id)}/extended",
            headers={"Authorization": auth},
            params={"short": "false"},
            timeout=10,
        )
        response.raise_for_status()
        record = response.json().get("data") or {}
        translation = self.fetch_series_translation(tvdb_id, auth)
        if translation.get("name"):
            record["name"] = translation["name"]
        if translation.get("overview"):
            record["overview"] = translation["overview"]
        return normalize_tvdb_series(record)

    def fetch_series_translation(self, tvdb_id, auth):
        if self.language == "en":
            return {}
        response = self.session.get(
            f"{self.base_url}/series/{int(tvdb_id)}/translations/{self.language}",
            headers={"Authorization": auth},
            timeout=10,
        )
        if response.status_code != 200:
            return {}
        return response.json().get("data") or {}


def normalize_tvdb_series(record):
    tvdb_id = record.get("id")
    first_aired = record.get("firstAired") or ""
    runtime = record.get("averageRuntime")
    remote_ids = record.get("remoteIds") or []
    provider_ids = {"Tvdb": str(tvdb_id)} if tvdb_id else {}

    imdb_id = None
    for remote in remote_ids:
        source = str(remote.get("sourceName") or "").lower()
        remote_id = str(remote.get("id") or "").strip()
        if not remote_id:
            continue
        if "imdb" in source:
            imdb_id = remote_id
            provider_ids["Imdb"] = remote_id
        if "movie" in source or "tmdb" in source:
            provider_ids["Tmdb"] = remote_id

    content_ratings = record.get("contentRatings") or []
    official = next((item.get("name") for item in content_ratings if item.get("name")), None)

    artworks = sorted(record.get("artworks") or [], key=lambda item: item.get("score") or 0, reverse=True)
    backdrop_url = _pick_artwork(artworks, preferred_types={3, 15, 16, 22})
    logo_url = _pick_artwork(artworks, preferred_types={23, 24, 25})

    return {
        "id": f"tvdb-{tvdb_id}" if tvdb_id else None,
        "title": record.get("name"),
        "original_title": record.get("name"),
        "year": first_aired[:4] if first_aired else None,
        "rating": record.get("score"),
        "overview": record.get("overview") or "",
        "genres": ", ".join(g.get("name") for g in (record.get("genres") or []) if g.get("name")),
        "runtime": f"{runtime} min" if runtime else "",
        "backdrop_url": backdrop_url or record.get("image"),
        "logo_url": logo_url,
        "officialRating": official,
        "imdb_id": imdb_id,
        "provider_ids": provider_ids,
        "source": "TVDB",
    }


def _pick_artwork(artworks, preferred_types):
    for artwork in artworks:
        if artwork.get("type") in preferred_types and artwork.get("image"):
            return artwork["image"]
    return None
