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

    @property
    def text(self):
        return str(self._payload)


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


def test_anticipated_movie_and_show_catalogs_are_supported():
    class CatalogSession(FakeSession):
        def get(self, url, headers=None, params=None, timeout=None):
            if url.endswith("/movies/anticipated"):
                return FakeResponse(200, [{"list_count": 5362, "movie": {"title": "The Martian", "year": 2015, "ids": {"tmdb": 286217, "imdb": "tt3659388"}}}])
            if url.endswith("/shows/anticipated"):
                return FakeResponse(200, [{"list_count": 5383, "show": {"title": "Supergirl", "year": 2015, "ids": {"tmdb": 62688, "tvdb": 295759, "imdb": "tt4016454"}}}])
            return super().get(url, headers=headers, params=params, timeout=timeout)

    config = {"client_id": "client", "access_token": "access", "expires_at": 999999999}
    client = TraktClient(config, session=CatalogSession(), now=lambda: 1000)

    items = client.fetch_catalog_items(["trakt_anticipated_movies", "trakt_anticipated_shows"], limit=20)

    assert items == [
        {"Id": "trakt-movie-286217", "Name": "The Martian", "catalog": "trakt_anticipated_movies"},
        {"Id": "trakt-tv-62688", "Name": "Supergirl", "catalog": "trakt_anticipated_shows"},
    ]


def test_start_device_auth_reports_forbidden_body():
    class ForbiddenSession(FakeSession):
        def post(self, url, json=None, headers=None, timeout=None):
            return FakeResponse(403, {"error": "invalid_api_key"})

    config = {"client_id": "bad-client", "client_secret": "secret"}
    client = TraktClient(config, session=ForbiddenSession(), now=lambda: 1000)

    try:
        client.start_device_auth()
    except Exception as error:
        assert "Trakt HTTP 403" in str(error)
        assert "invalid_api_key" in str(error)
    else:
        raise AssertionError("expected forbidden error")


def test_poll_device_auth_reports_invalid_device_code():
    class NotFoundSession(FakeSession):
        def post(self, url, json=None, headers=None, timeout=None):
            return FakeResponse(404, {"error": "not_found"})

    config = {"client_id": "client", "client_secret": "secret", "device_code": "bad-device"}
    client = TraktClient(config, session=NotFoundSession(), now=lambda: 1000)

    result = client.poll_device_auth()

    assert result["status"] == "failed"
    assert "Start OAuth again" in result["message"]
