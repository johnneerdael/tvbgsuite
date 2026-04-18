from providers.config_schema import default_config, merge_config


REMOVED_KEYS = {"jellyfin", "plex", "radarr", "sonarr", "jellyseerr"}


def test_default_config_contains_new_provider_sections():
    config = default_config()

    assert REMOVED_KEYS.isdisjoint(config)
    assert config["providers"]["sources"] == ["tmdb", "trakt"]
    assert config["providers"]["metadata"] == ["tmdb", "tvdb"]
    assert config["providers"]["ratings"] == ["tmdb", "mdblist", "imdb_ratings"]
    assert config["metadata"]["movie_provider"] == "tmdb"
    assert config["metadata"]["tv_provider"] == "tmdb"
    assert config["tvdb"]["base_url"] == "https://api4.thetvdb.com/v4"
    assert config["tvdb"]["api_key"] == ""
    assert config["tvdb"]["pin"] == ""
    assert config["tvdb"]["language"] == "en"
    assert config["mdblist"]["enabled"] is False
    assert config["imdb_ratings"]["enabled"] is False
    assert config["ratings"]["default_provider"] == "tmdb"
    assert "trakt_trending_movies" in config["trakt"]["catalogs"]["enabled"]


def test_merge_config_preserves_existing_supported_values():
    merged = merge_config({
        "tmdb": {"api_key": "tmdb-key", "language": "nl-NL"},
        "trakt": {"api_key": "old-client-id", "username": "john", "listname": "watchlist"},
        "general": {"overwrite_existing": True},
        "jellyfin": {"url": "http://removed"},
    })

    assert merged["tmdb"]["api_key"] == "tmdb-key"
    assert merged["tmdb"]["language"] == "nl-NL"
    assert merged["trakt"]["client_id"] == "old-client-id"
    assert merged["trakt"]["api_key"] == "old-client-id"
    assert merged["trakt"]["username"] == "john"
    assert merged["trakt"]["listname"] == "watchlist"
    assert merged["general"]["overwrite_existing"] is True
    assert "jellyfin" not in merged


def test_merge_config_drops_removed_integrations_from_existing_config():
    merged = merge_config({
        "jellyfin": {"url": "http://old"},
        "plex": {"url": "http://old"},
        "radarr": {"url": "http://old"},
        "sonarr": {"url": "http://old"},
        "jellyseerr": {"url": "http://old"},
        "tmdb": {"api_key": "tmdb-key"},
    })

    assert REMOVED_KEYS.isdisjoint(merged)
    assert merged["tmdb"]["api_key"] == "tmdb-key"
