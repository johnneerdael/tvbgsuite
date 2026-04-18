from providers.metadata_router import merge_metadata


def test_merge_metadata_keeps_fallback_provider_ids():
    merged = merge_metadata(
        {"title": "TMDB", "provider_ids": {"Tmdb": "1399", "Tvdb": "121361"}},
        {"title": "TVDB", "provider_ids": {"Tvdb": "121361", "Imdb": "tt0944947"}},
    )

    assert merged["title"] == "TVDB"
    assert merged["provider_ids"] == {
        "Tmdb": "1399",
        "Tvdb": "121361",
        "Imdb": "tt0944947",
    }
