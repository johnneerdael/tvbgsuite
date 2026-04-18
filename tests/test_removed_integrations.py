from providers.config_schema import default_config, merge_config
import gui_editor


REMOVED_KEYS = {"jellyfin", "plex", "radarr", "sonarr", "jellyseerr"}


def test_default_config_excludes_removed_integrations():
    config = default_config()

    assert REMOVED_KEYS.isdisjoint(config)
    assert set(config["providers"]["sources"]) == {"tmdb", "trakt"}
    assert set(config["providers"]["metadata"]) == {"tmdb", "tvdb"}
    assert set(config["providers"]["ratings"]) == {"tmdb", "mdblist", "imdb_ratings"}


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


def test_removed_connection_routes_are_not_registered():
    from flask import Flask

    app = Flask(__name__)
    app.register_blueprint(gui_editor.gui_editor_bp)
    rules = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/api/test/jellyfin" not in rules
    assert "/api/test/plex" not in rules
    assert "/api/test/radarr" not in rules
    assert "/api/test/sonarr" not in rules
    assert "/api/test/jellyseerr" not in rules
