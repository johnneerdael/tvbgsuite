from providers.ratings import apply_configured_rating


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def test_custom_imdb_rating_replaces_tmdb_rating(monkeypatch):
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append((url, headers))
        return FakeResponse(200, {"tconst": "tt0944947", "averageRating": 9.2, "numVotes": 1000})

    monkeypatch.setattr("providers.ratings.requests.get", fake_get)

    metadata = {"imdb_id": "tt0944947", "rating": 8.1}
    config = {
        "ratings": {"default_provider": "imdb_api"},
        "imdb_ratings": {"enabled": True, "base_url": "https://imdb.example", "api_key": "secret"},
    }

    enriched = apply_configured_rating(metadata, config)

    assert enriched["rating"] == 9.2
    assert enriched["rating_provider"] == "imdb_api"
    assert enriched["rating_logo"] == "imdb_logo_2016.svg"
    assert calls[0][0] == "https://imdb.example/v1/ratings/tt0944947"
    assert calls[0][1]["X-API-Key"] == "secret"


def test_mdblist_tomatoes_rating_uses_mdblist_contract(monkeypatch):
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return FakeResponse(200, {"ratings": [{"id": "tt0944947", "rating": 96}]})

    monkeypatch.setattr("providers.ratings.requests.post", fake_post)

    metadata = {"imdb_id": "tt0944947", "rating": 8.1}
    config = {
        "ratings": {"default_provider": "mdblist_tomatoes"},
        "mdblist": {"enabled": True, "api_key": "mdb-key"},
    }

    enriched = apply_configured_rating(metadata, config)

    assert enriched["rating"] == 96
    assert enriched["rating_provider"] == "mdblist_tomatoes"
    assert enriched["rating_logo"] == "mdblist_tomatoes.svg"
    assert calls[0][0] == "https://api.mdblist.com/rating/show/tomatoes?apikey=mdb-key"
    assert calls[0][1] == {"ids": ["tt0944947"], "provider": "imdb"}
