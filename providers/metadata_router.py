from providers.tvdb_client import TVDBClient


def choose_tv_metadata(tmdb_details, media_type, config):
    if media_type != "tv":
        return tmdb_details
    metadata_config = config.get("metadata", {})
    if metadata_config.get("tv_provider") != "tvdb":
        return tmdb_details

    provider_ids = tmdb_details.get("provider_ids") or {}
    tvdb_id = provider_ids.get("Tvdb") or provider_ids.get("tvdb") or provider_ids.get("tvdb_id")
    if not tvdb_id:
        return tmdb_details

    tvdb_details = TVDBClient(config.get("tvdb", {})).fetch_series_details(tvdb_id)
    return merge_metadata(tmdb_details, tvdb_details)


def merge_metadata(fallback, preferred):
    if not preferred:
        return fallback
    merged = dict(fallback or {})
    merged.update({key: value for key, value in preferred.items() if value not in (None, "", [], {})})
    merged["provider_ids"] = {
        **((fallback or {}).get("provider_ids") or {}),
        **(preferred.get("provider_ids") or {}),
    }
    return merged
