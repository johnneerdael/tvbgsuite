from providers.trakt_client import TraktClient


class FakeResponse:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeSession:
    def __init__(self):
        self.posts = []
        self.gets = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.posts.append((url, json, headers))
        if url.endswith("/oauth/device/code"):
            return FakeResponse(200, {
                "device_code": "device",
                "user_code": "ABC12345",
                "verification_url": "https://trakt.tv/activate",
                "expires_in": 600,
                "interval": 5,
            })
        return FakeResponse(200, {
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 604800,
        })

    def get(self, url, headers=None, params=None, timeout=None):
        self.gets.append((url, headers, params))
        return FakeResponse(200, {"user": {"username": "john"}})


def test_start_device_auth_returns_codes_and_updates_config():
    config = {"client_id": "client", "client_secret": "secret"}
    client = TraktClient(config, session=FakeSession(), now=lambda: 1000)

    result = client.start_device_auth()

    assert result["user_code"] == "ABC12345"
    assert config["device_code"] == "device"
    assert config["poll_interval"] == 5
    assert config["device_expires_at"] == 1600


def test_poll_device_auth_saves_tokens_and_username():
    config = {"client_id": "client", "client_secret": "secret", "device_code": "device"}
    client = TraktClient(config, session=FakeSession(), now=lambda: 1000)

    result = client.poll_device_auth()

    assert result["status"] == "approved"
    assert config["access_token"] == "access"
    assert config["refresh_token"] == "refresh"
    assert config["expires_at"] == 605800
    assert config["username"] == "john"


def test_catalog_item_ids_are_normalized_for_tmdb_enrichment():
    class CatalogSession(FakeSession):
        def get(self, url, headers=None, params=None, timeout=None):
            if url.endswith("/movies/trending"):
                return FakeResponse(200, [{"movie": {"title": "Dune", "year": 2021, "ids": {"tmdb": 438631, "imdb": "tt1160419"}}}])
            return super().get(url, headers=headers, params=params, timeout=timeout)

    config = {"client_id": "client", "access_token": "access", "expires_at": 999999999}
    client = TraktClient(config, session=CatalogSession(), now=lambda: 1000)

    items = client.fetch_catalog_items(["trakt_trending_movies"], limit=20)

    assert items == [{"Id": "trakt-movie-438631", "Name": "Dune", "catalog": "trakt_trending_movies"}]
