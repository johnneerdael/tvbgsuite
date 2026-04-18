import time
from datetime import date

import requests


TRAKT_API_URL = "https://api.trakt.tv"
TRAKT_API_VERSION = "2"

TRAKT_CATALOG_ENDPOINTS = {
    "trakt_trending_movies": ("movies/trending", "movie"),
    "trakt_trending_shows": ("shows/trending", "show"),
    "trakt_popular_movies": ("movies/popular", "movie"),
    "trakt_popular_shows": ("shows/popular", "show"),
    "trakt_recommended_movies": ("recommendations/movies", "movie"),
    "trakt_recommended_shows": ("recommendations/shows", "show"),
}

TRAKT_BUILT_IN_CATALOG_OPTIONS = [
    {"id": "trakt_trending_movies", "title": "Trending Movies"},
    {"id": "trakt_trending_shows", "title": "Trending Shows"},
    {"id": "trakt_popular_movies", "title": "Popular Movies"},
    {"id": "trakt_popular_shows", "title": "Popular Shows"},
    {"id": "trakt_recommended_movies", "title": "Recommended Movies"},
    {"id": "trakt_recommended_shows", "title": "Recommended Shows"},
    {"id": "trakt_calendar_next_7_days", "title": "Calendar: Next 7 Days"},
]


class TraktClient:
    def __init__(self, config, session=None, now=None):
        self.config = config
        self.session = session or requests.Session()
        self.now = now or time.time

    def base_headers(self, authorized=False):
        client_id = self.config.get("client_id") or self.config.get("api_key") or ""
        headers = {
            "Content-Type": "application/json",
            "trakt-api-version": TRAKT_API_VERSION,
            "trakt-api-key": client_id,
        }
        if authorized and self.config.get("access_token"):
            headers["Authorization"] = f"Bearer {self.config['access_token']}"
        return headers

    def start_device_auth(self):
        response = self.session.post(
            f"{TRAKT_API_URL}/oauth/device/code",
            json={"client_id": self.config.get("client_id") or self.config.get("api_key")},
            headers=self.base_headers(),
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        self.config.update({
            "device_code": data.get("device_code", ""),
            "user_code": data.get("user_code", ""),
            "verification_url": data.get("verification_url", ""),
            "poll_interval": data.get("interval", 5),
            "device_expires_at": int(self.now()) + int(data.get("expires_in", 0)),
        })
        return data

    def poll_device_auth(self):
        response = self.session.post(
            f"{TRAKT_API_URL}/oauth/device/token",
            json={
                "code": self.config.get("device_code"),
                "client_id": self.config.get("client_id") or self.config.get("api_key"),
                "client_secret": self.config.get("client_secret"),
            },
            headers=self.base_headers(),
            timeout=10,
        )
        if response.status_code == 400:
            return {"status": "pending"}
        if response.status_code == 409:
            return {"status": "already_used"}
        if response.status_code == 410:
            return {"status": "expired"}
        if response.status_code == 418:
            return {"status": "denied"}
        if response.status_code == 429:
            next_interval = int(self.config.get("poll_interval") or 5) + 5
            self.config["poll_interval"] = min(next_interval, 60)
            return {"status": "slow_down", "poll_interval": self.config["poll_interval"]}
        response.raise_for_status()
        data = response.json()
        self.config.update({
            "access_token": data.get("access_token", ""),
            "refresh_token": data.get("refresh_token", ""),
            "expires_at": int(self.now()) + int(data.get("expires_in", 0)),
            "device_code": "",
            "user_code": "",
        })
        username = self.fetch_username()
        if username:
            self.config["username"] = username
        return {"status": "approved", "username": username}

    def fetch_username(self):
        response = self.session.get(
            f"{TRAKT_API_URL}/users/settings",
            headers=self.base_headers(authorized=True),
            timeout=10,
        )
        if response.status_code != 200:
            return None
        return (response.json().get("user") or {}).get("username")

    def ensure_token(self):
        if not self.config.get("access_token"):
            return False
        if int(self.config.get("expires_at") or 0) - 60 > int(self.now()):
            return True
        if not self.config.get("refresh_token"):
            return False
        response = self.session.post(
            f"{TRAKT_API_URL}/oauth/token",
            json={
                "refresh_token": self.config.get("refresh_token"),
                "client_id": self.config.get("client_id") or self.config.get("api_key"),
                "client_secret": self.config.get("client_secret"),
                "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
                "grant_type": "refresh_token",
            },
            headers=self.base_headers(),
            timeout=10,
        )
        if response.status_code != 200:
            return False
        data = response.json()
        self.config["access_token"] = data.get("access_token", "")
        self.config["refresh_token"] = data.get("refresh_token", self.config.get("refresh_token", ""))
        self.config["expires_at"] = int(self.now()) + int(data.get("expires_in", 0))
        return True

    def fetch_catalog_items(self, catalog_ids, limit=20):
        if not self.ensure_token():
            return []
        output = []
        for catalog_id in catalog_ids:
            if catalog_id in TRAKT_CATALOG_ENDPOINTS:
                endpoint, media_type = TRAKT_CATALOG_ENDPOINTS[catalog_id]
                output.extend(self._fetch_simple_catalog(catalog_id, endpoint, media_type, limit))
            elif catalog_id == "trakt_calendar_next_7_days":
                output.extend(self._fetch_calendar_catalog(limit))
            elif catalog_id.startswith("popular_list:"):
                output.extend(self._fetch_popular_list_catalog(catalog_id, limit))
        return output[: int(limit or 20)]

    def _fetch_simple_catalog(self, catalog_id, endpoint, media_type, limit):
        response = self.session.get(
            f"{TRAKT_API_URL}/{endpoint}",
            headers=self.base_headers(authorized=True),
            params={"limit": int(limit or 20)},
            timeout=10,
        )
        if response.status_code != 200:
            return []
        items = []
        for item in response.json():
            tmdb_id = _catalog_tmdb_id(item, media_type)
            title = _catalog_title(item, media_type)
            if tmdb_id and title:
                items.append({"Id": _catalog_item_id(media_type, tmdb_id), "Name": title, "catalog": catalog_id})
        return items

    def _fetch_calendar_catalog(self, limit):
        start_date = date.today().isoformat()
        response = self.session.get(
            f"{TRAKT_API_URL}/calendars/my/shows/{start_date}/7",
            headers=self.base_headers(authorized=True),
            params={"limit": int(limit or 20)},
            timeout=10,
        )
        if response.status_code != 200:
            return []
        items = []
        for item in response.json():
            show = item.get("show") or {}
            tmdb_id = (show.get("ids") or {}).get("tmdb")
            title = show.get("title")
            if tmdb_id and title:
                items.append({"Id": f"trakt-tv-{tmdb_id}", "Name": title, "catalog": "trakt_calendar_next_7_days"})
        return items

    def fetch_popular_lists(self, limit=30):
        if not self.ensure_token():
            return []
        response = self.session.get(
            f"{TRAKT_API_URL}/lists/popular",
            headers=self.base_headers(authorized=True),
            params={"page": 1, "limit": int(limit or 30)},
            timeout=10,
        )
        if response.status_code != 200:
            return []
        output = []
        for item in response.json():
            list_data = item.get("list") or {}
            user_data = list_data.get("user") or {}
            user = (user_data.get("ids") or {}).get("slug") or user_data.get("username")
            list_id = (list_data.get("ids") or {}).get("slug")
            name = list_data.get("name")
            if user and list_id and name:
                output.append({"key": f"popular_list:{user}:{list_id}", "title": name, "user": user, "list": list_id})
        return output

    def _fetch_popular_list_catalog(self, catalog_id, limit):
        _, user, list_id = catalog_id.split(":", 2)
        items = []
        for media_type, path_type in (("movie", "movies"), ("show", "shows")):
            response = self.session.get(
                f"{TRAKT_API_URL}/users/{user}/lists/{list_id}/items/{path_type}",
                headers=self.base_headers(authorized=True),
                params={"limit": int(limit or 20)},
                timeout=10,
            )
            if response.status_code != 200:
                continue
            for item in response.json():
                tmdb_id = _catalog_tmdb_id(item, media_type)
                title = _catalog_title(item, media_type)
                if tmdb_id and title:
                    items.append({"Id": _catalog_item_id(media_type, tmdb_id), "Name": title, "catalog": catalog_id})
        return items


def _catalog_title(item, media_type):
    media = item.get(media_type) if media_type in item else item
    return media.get("title") or media.get("name")


def _catalog_tmdb_id(item, media_type):
    media = item.get(media_type) if media_type in item else item
    return (media.get("ids") or {}).get("tmdb")


def _catalog_item_id(media_type, tmdb_id):
    tmdb_type = "movie" if media_type == "movie" else "tv"
    return f"trakt-{tmdb_type}-{tmdb_id}"
