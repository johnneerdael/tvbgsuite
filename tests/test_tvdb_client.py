from providers.tvdb_client import TVDBClient


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class FakeSession:
    def __init__(self):
        self.posts = []
        self.gets = []

    def post(self, url, json=None, timeout=None):
        self.posts.append((url, json, timeout))
        return FakeResponse(200, {"data": {"token": "tvdb-token"}})

    def get(self, url, headers=None, params=None, timeout=None):
        self.gets.append((url, headers, params, timeout))
        return FakeResponse(200, {
            "data": {
                "id": 121361,
                "name": "Game of Thrones",
                "overview": "Nine noble families fight for control.",
                "firstAired": "2011-04-17",
                "averageRuntime": 55,
                "score": 8.7,
                "genres": [{"name": "Drama"}, {"name": "Fantasy"}],
                "contentRatings": [{"name": "TV-MA", "country": "usa"}],
                "remoteIds": [
                    {"sourceName": "IMDB", "id": "tt0944947"},
                    {"sourceName": "TheMovieDB.com", "id": "1399"},
                ],
                "artworks": [
                    {"image": "https://art.example/backdrop.jpg", "type": 3, "score": 10},
                    {"image": "https://art.example/logo.png", "type": 23, "score": 9},
                ],
            }
        })


def test_fetch_series_details_normalizes_tvdb_payload():
    session = FakeSession()
    client = TVDBClient({"enabled": True, "api_key": "key", "pin": "pin"}, session=session, now=lambda: 1000)

    details = client.fetch_series_details(121361)

    assert details["id"] == "tvdb-121361"
    assert details["title"] == "Game of Thrones"
    assert details["year"] == "2011"
    assert details["rating"] == 8.7
    assert details["runtime"] == "55 min"
    assert details["genres"] == "Drama, Fantasy"
    assert details["officialRating"] == "TV-MA"
    assert details["imdb_id"] == "tt0944947"
    assert details["provider_ids"]["Tvdb"] == "121361"
    assert details["provider_ids"]["Tmdb"] == "1399"
    assert details["source"] == "TVDB"
    assert details["backdrop_url"] == "https://art.example/backdrop.jpg"
    assert details["logo_url"] == "https://art.example/logo.png"
    assert session.posts[0][1] == {"apikey": "key", "pin": "pin"}


def test_fetch_series_details_applies_configured_localization():
    class LocalizedSession(FakeSession):
        def get(self, url, headers=None, params=None, timeout=None):
            if url.endswith("/series/121361/translations/nl"):
                return FakeResponse(200, {
                    "data": {
                        "name": "Game of Thrones NL",
                        "overview": "Nederlandse omschrijving.",
                    }
                })
            return super().get(url, headers=headers, params=params, timeout=timeout)

    client = TVDBClient(
        {"enabled": True, "api_key": "key", "language": "nl"},
        session=LocalizedSession(),
        now=lambda: 1000,
    )

    details = client.fetch_series_details(121361)

    assert details["title"] == "Game of Thrones NL"
    assert details["overview"] == "Nederlandse omschrijving."
