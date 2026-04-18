import gui_editor


def app_client():
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(gui_editor.gui_editor_bp)
    return app.test_client()


def test_tmdb_item_uses_tvdb_when_tv_provider_is_tvdb(monkeypatch):
    monkeypatch.setattr(gui_editor, "load_config", lambda: {
        "metadata": {"tv_provider": "tvdb"},
        "tmdb": {"api_key": "tmdb-key", "language": "en-US"},
        "tvdb": {"enabled": True, "api_key": "tvdb-key", "pin": "", "base_url": "https://api4.thetvdb.com/v4"},
        "ratings": {"default_provider": "tmdb"},
    })

    monkeypatch.setattr(gui_editor, "fetch_tmdb_details", lambda tmdb_id, media_type, config: {
        "id": f"trakt-{media_type}-{tmdb_id}",
        "title": "TMDB Title",
        "provider_ids": {"Tmdb": tmdb_id, "Tvdb": "121361"},
        "source": "TMDB",
    })

    monkeypatch.setattr(gui_editor, "fetch_tvdb_details", lambda tvdb_id, config: {
        "id": f"tvdb-{tvdb_id}",
        "title": "TVDB Title",
        "provider_ids": {"Tvdb": tvdb_id, "Tmdb": "1399"},
        "source": "TVDB",
    })

    monkeypatch.setattr(gui_editor, "apply_configured_rating", lambda metadata, config: metadata)

    response = app_client().get("/api/media/item/tmdb-tv-1399")

    assert response.status_code == 200
    assert response.json["title"] == "TVDB Title"
    assert response.json["source"] == "TVDB"
