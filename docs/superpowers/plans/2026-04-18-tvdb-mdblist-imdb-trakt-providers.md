# TVDB, Rating Providers, And Trakt Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep TMDB, add TheTVDB metadata for TV content, add selectable MDBList and custom IMDb Ratings API providers with bundled logos, upgrade Trakt to full OAuth catalog generation, and remove unused Jellyfin/Plex/Radarr/Sonarr/Jellyseerr integrations.

**Architecture:** Keep the existing Flask/Fabric.js rendering pipeline, but simplify the provider surface before adding new integrations. Backend endpoints return the same normalized media dictionaries the editor already consumes, with new localization, `rating_provider`, `rating_logo`, and provider-id fields added. The batch UI becomes catalog-oriented: TMDB and Trakt provide source items, TheTVDB enriches TV metadata, and rating providers decorate the final metadata before rendering.

**Tech Stack:** Flask, requests, pytest, Fabric.js, Node canvas renderer, Docker.

---

## Scope Split

This request spans several independent subsystems. Keep them in one feature branch, but land them as small commits in this order:

1. Remove unused provider integrations: Jellyfin, Plex, Radarr, Sonarr, and Jellyseerr.
2. Configuration and test harness for the smaller provider set.
3. TheTVDB client, localization, and TV metadata routing.
4. Rating provider abstraction for TMDB, MDBList, and custom IMDb Ratings API.
5. Local rating/provider logos.
6. Trakt OAuth and catalog APIs.
7. Batch/cron UI wiring.
8. Docker/docs verification.

Do not modify `.env`, `compose.yml`, or the local API spec files unless the user explicitly asks. They are currently untracked or modified working files.

## Local References

- tvbgsuite current Flask app: `gui_editor.py`
- tvbgsuite current batch frontend: `static/js/batch.js`
- tvbgsuite current editor frontend: `static/js/editor.js`
- tvbgsuite current template: `templates/editor.html`
- tvbgsuite server renderer: `render_task.js`
- Screenshot context: `/Users/jneerdael/Downloads/screencapture-localhost-5000-editor-2026-04-18-13_40_48.png`
- TVDB API spec: `tvdb.yml`
- MDBList API spec: `mdblist.apib`
- Trakt API spec: `trakt.apib`
- Nexio Trakt catalog IDs: `/Users/jneerdael/Scripts/nexio/app/src/main/java/com/nexio/tv/data/local/TraktSettingsDataStore.kt`
- Nexio Trakt catalog fetches: `/Users/jneerdael/Scripts/nexio/app/src/main/java/com/nexio/tv/data/repository/TraktDiscoveryService.kt`
- Nexio Trakt OAuth device flow: `/Users/jneerdael/Scripts/nexio/app/src/main/java/com/nexio/tv/data/repository/TraktAuthService.kt`
- Nexio MDBList rating contract: `/Users/jneerdael/Scripts/nexio/app/src/main/java/com/nexio/tv/data/repository/MDBListRepository.kt`
- Nexio custom IMDb API client: `/Users/jneerdael/Scripts/nexio/app/src/main/java/com/nexio/tv/data/remote/CustomImdbClient.kt`
- Nexio logos: `/Users/jneerdael/Scripts/nexio/app/src/main/res/raw/` and `/Users/jneerdael/Scripts/nexio/app/src/main/res/drawable/`
- Custom IMDb ratings API: `/Users/jneerdael/Scripts/nexio-imdbratings/docs/api.apib`

## File Structure

Create:

- `providers/__init__.py`: package marker.
- `providers/config_schema.py`: default config shape and merge helper.
- `providers/tvdb_client.py`: TVDB login/token cache, localized series lookup, normalized TV metadata.
- `providers/ratings.py`: rating-provider selection and normalized rating enrichment.
- `providers/trakt_client.py`: Trakt OAuth token handling and catalog fetches.
- `tests/test_config_schema.py`: config defaults and removed-provider cleanup tests.
- `tests/test_tvdb_client.py`: TVDB login, token reuse, localization, and series normalization tests.
- `tests/test_ratings.py`: MDBList/custom IMDb provider tests.
- `tests/test_trakt_client.py`: OAuth polling and catalog mapping tests.
- `tests/test_media_routes.py`: Flask route integration tests using mocked provider clients.
- `static/provider_logos/imdb_logo_2016.svg`
- `static/provider_logos/mdblist_trakt.svg`
- `static/provider_logos/mdblist_tmdb.svg`
- `static/provider_logos/mdblist_letterboxd.svg`
- `static/provider_logos/mdblist_tomatoes.svg`
- `static/provider_logos/mdblist_audience.png`
- `static/provider_logos/mdblist_metacritic.png`

Modify:

- `requirements.txt`: add pytest.
- `config.example.json`: document the new config keys.
- `gui_editor.py`: remove unused provider routes/helpers, use config schema, provider modules, new routes, and enriched media responses.
- `cron_runner.py`: remove unused provider fetchers, use shared provider modules and Trakt catalogs for server-side jobs.
- `static/js/editor.js`: save/load new settings and render local rating logos.
- `static/js/batch.js`: support Trakt Catalog source mode.
- `templates/editor.html`: remove unused provider panels, add TheTVDB/MDBList/IMDb/Trakt OAuth controls, rating-provider selector, catalog selector.
- `render_task.js`: use local rating logos and provider metadata during server-side rendering.
- `Dockerfile`: ensure bundled provider logos are copied into defaults if needed.
- `README.md`: update provider settings and batch catalog usage.

## Task 0: Remove Unused Provider Integrations

**Files:**
- Modify: `gui_editor.py`
- Modify: `cron_runner.py`
- Modify: `static/js/editor.js`
- Modify: `static/js/batch.js`
- Modify: `templates/editor.html`
- Modify: `static/js/translations.js`
- Modify: `README.md`
- Modify: `config.example.json`

- [ ] **Step 1: Add failing removal tests**

Create `tests/test_removed_integrations.py`:

```python
from providers.config_schema import default_config, merge_config


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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
python -m pytest tests/test_removed_integrations.py -q
```

Expected: FAIL until `providers.config_schema` exists and excludes the removed integrations.

- [ ] **Step 3: Remove backend routes and fetchers**

In `gui_editor.py`, delete these functions and route handlers:

```text
format_jellyfin_item
fetch_jellyfin_list
fetch_plex_list
format_plex_item
fetch_sonarr_list
fetch_radarr_list
test_jellyfin
test_plex
test_radarr
test_sonarr
test_jellyseerr
```

In `/api/media/random`, replace Jellyfin random lookup with a TMDB random/trending lookup:

```python
@gui_editor_bp.route('/api/media/random')
def get_random_media():
    config = load_config()
    items = fetch_tmdb_list(config, limit_count=20)
    if items:
        item = random.choice(items)
        return get_media_item(item["Id"])
    sample = random.choice(mock_samples)
    sample["source"] = "Demo Mode"
    response = jsonify(sample)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response
```

In `/api/media/list`, restrict provider dispatch to:

```python
        if p == 'trakt':
            all_items.extend(fetch_trakt_list(config))
        elif p == 'tmdb':
            all_items.extend(fetch_tmdb_list(config, limit_count))
```

In `/api/media/item/<item_id>`, remove the `jellyfin`, `plex`, `sonarr`, and `radarr` branches. Leave only `trakt`, `tmdb`, and the new `tvdb` branch from Task 3.

- [ ] **Step 4: Remove frontend provider cards and checkboxes**

In `templates/editor.html`, delete settings panels with ids:

```text
set-group-jf
set-group-plex
set-group-radarr
set-group-sonarr
set-group-jellyseerr
```

In batch provider selection, remove checkboxes with values:

```text
jellyfin
plex
sonarr
radarr
```

Keep `tmdb` and `trakt`, and add `trakt_catalogs` source mode in Task 7.

In `static/js/editor.js`, delete settings save fields and test functions for:

```text
jellyfin
plex
radarr
sonarr
jellyseerr
```

In `static/js/batch.js`, remove the `missing` filter injection and any client behavior that references Radarr/Sonarr wanted searches.

- [ ] **Step 5: Remove cron provider fetchers**

In `cron_runner.py`, delete:

```text
fetch_jellyfin_cron
fetch_plex_cron
fetch_sonarr_cron
fetch_radarr_cron
resolve_tmdb_from_tvdb
```

In `fetch_items_and_process()`, provider dispatch becomes:

```python
        if p == 'trakt':
            all_meta.extend(fetch_trakt_cron(config, job))
        elif p == 'tmdb':
            all_meta.extend(fetch_tmdb_cron(config, job))
```

Ensure cron jobs saved by the UI only emit `providers: ["tmdb"]`, `providers: ["trakt"]`, or both.

- [ ] **Step 6: Run removal validation and commit**

Run:

```bash
python -m pytest tests/test_removed_integrations.py -q
python -m py_compile gui_editor.py cron_runner.py
```

Expected: tests pass and py_compile has no output.

Commit:

```bash
git add gui_editor.py cron_runner.py static/js/editor.js static/js/batch.js templates/editor.html static/js/translations.js README.md config.example.json tests/test_removed_integrations.py
git commit -m "refactor: remove unused media server integrations"
```

## Task 1: Config Schema And Test Harness

**Files:**
- Create: `providers/__init__.py`
- Create: `providers/config_schema.py`
- Create: `tests/test_config_schema.py`
- Modify: `requirements.txt`
- Modify: `config.example.json`
- Modify: `gui_editor.py`

- [ ] **Step 1: Add failing config tests**

Create `tests/test_config_schema.py`:

```python
from providers.config_schema import default_config, merge_config


def test_default_config_contains_new_provider_sections():
    config = default_config()

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


def test_merge_config_preserves_existing_legacy_values():
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python -m pytest tests/test_config_schema.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'providers'`.

- [ ] **Step 3: Implement config schema**

Create `providers/__init__.py` as an empty file.

Create `providers/config_schema.py`:

```python
from copy import deepcopy


TRAKT_BUILT_IN_CATALOGS = [
    "trakt_up_next",
    "trakt_trending_movies",
    "trakt_trending_shows",
    "trakt_popular_movies",
    "trakt_popular_shows",
    "trakt_recommended_movies",
    "trakt_recommended_shows",
    "trakt_calendar_next_7_days",
]


def default_config():
    return {
        "general": {"overwrite_existing": False, "timezone_offset": 1},
        "providers": {
            "sources": ["tmdb", "trakt"],
            "metadata": ["tmdb", "tvdb"],
            "ratings": ["tmdb", "mdblist", "imdb_ratings"],
        },
        "metadata": {"movie_provider": "tmdb", "tv_provider": "tmdb"},
        "tmdb": {"api_key": "", "language": "de-DE"},
        "tvdb": {
            "enabled": False,
            "base_url": "https://api4.thetvdb.com/v4",
            "api_key": "",
            "pin": "",
            "language": "en",
        },
        "mdblist": {
            "enabled": False,
            "api_key": "",
            "show_trakt": True,
            "show_tmdb": True,
            "show_letterboxd": True,
            "show_tomatoes": True,
            "show_audience": True,
            "show_metacritic": True,
        },
        "imdb_ratings": {"enabled": False, "base_url": "", "api_key": ""},
        "ratings": {"default_provider": "tmdb"},
        "trakt": {
            "api_key": "",
            "client_id": "",
            "client_secret": "",
            "username": "",
            "listname": "",
            "access_token": "",
            "refresh_token": "",
            "expires_at": 0,
            "device_code": "",
            "user_code": "",
            "verification_url": "",
            "poll_interval": 5,
            "device_expires_at": 0,
            "catalogs": {
                "enabled": ["trakt_trending_movies", "trakt_trending_shows"],
                "selected_popular_list_keys": [],
            },
        },
        "editor": {"resolution": "1080"},
        "cron": {"enabled": False, "start_time": "00:00", "frequency": "1"},
        "cron_jobs": [],
    }


def merge_config(loaded):
    merged = deepcopy(default_config())
    if not isinstance(loaded, dict):
        return merged
    removed_keys = {"jellyfin", "plex", "radarr", "sonarr", "jellyseerr"}

    for key, value in loaded.items():
        if key in removed_keys:
            continue
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key].update(value)
        else:
            merged[key] = value

    trakt = merged.setdefault("trakt", {})
    if trakt.get("api_key") and not trakt.get("client_id"):
        trakt["client_id"] = trakt["api_key"]
    if trakt.get("client_id") and not trakt.get("api_key"):
        trakt["api_key"] = trakt["client_id"]

    catalogs = trakt.setdefault("catalogs", {})
    catalogs.setdefault("enabled", ["trakt_trending_movies", "trakt_trending_shows"])
    catalogs.setdefault("selected_popular_list_keys", [])
    return merged
```

Modify `requirements.txt`:

```text
Flask
requests
Pillow
numpy
python-dotenv
pytest
```

Modify `gui_editor.py` imports near the existing imports:

```python
from providers.config_schema import default_config, merge_config
```

Replace the `defaults = { ... }` block inside `load_config()` with:

```python
    defaults = default_config()
```

Replace the JSON merge loop in `load_config()` with:

```python
                return merge_config(loaded)
```

Keep the final `return defaults` for missing or unreadable config files.

- [ ] **Step 4: Update example config**

Replace `config.example.json` with:

```json
{
  "general": {
    "overwrite_existing": false,
    "timezone_offset": 1
  },
  "providers": {
    "sources": [
      "tmdb",
      "trakt"
    ],
    "metadata": [
      "tmdb",
      "tvdb"
    ],
    "ratings": [
      "tmdb",
      "mdblist",
      "imdb_ratings"
    ]
  },
  "metadata": {
    "movie_provider": "tmdb",
    "tv_provider": "tmdb"
  },
  "tmdb": {
    "api_key": "",
    "language": "de-DE"
  },
  "tvdb": {
    "enabled": false,
    "base_url": "https://api4.thetvdb.com/v4",
    "api_key": "",
    "pin": "",
    "language": "en"
  },
  "mdblist": {
    "enabled": false,
    "api_key": "",
    "show_trakt": true,
    "show_tmdb": true,
    "show_letterboxd": true,
    "show_tomatoes": true,
    "show_audience": true,
    "show_metacritic": true
  },
  "imdb_ratings": {
    "enabled": false,
    "base_url": "",
    "api_key": ""
  },
  "ratings": {
    "default_provider": "tmdb"
  },
  "trakt": {
    "client_id": "",
    "client_secret": "",
    "username": "",
    "listname": "",
    "access_token": "",
    "refresh_token": "",
    "expires_at": 0,
    "catalogs": {
      "enabled": [
        "trakt_trending_movies",
        "trakt_trending_shows"
      ],
      "selected_popular_list_keys": []
    }
  },
  "editor": {
    "resolution": "1080"
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m pytest tests/test_config_schema.py -q
```

Expected: PASS.

Commit:

```bash
git add providers/__init__.py providers/config_schema.py tests/test_config_schema.py requirements.txt config.example.json gui_editor.py
git commit -m "feat: add provider config schema"
```

## Task 2: TVDB Client

**Files:**
- Create: `providers/tvdb_client.py`
- Create: `tests/test_tvdb_client.py`

- [ ] **Step 1: Add failing TVDB tests**

Create `tests/test_tvdb_client.py`:

```python
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
                    {"sourceName": "TheMovieDB.com", "id": "1399"}
                ],
                "artworks": [
                    {"image": "https://art.example/backdrop.jpg", "type": 3, "score": 10},
                    {"image": "https://art.example/logo.png", "type": 23, "score": 9}
                ]
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
                        "overview": "Nederlandse omschrijving."
                    }
                })
            return super().get(url, headers=headers, params=params, timeout=timeout)

    client = TVDBClient(
        {"enabled": True, "api_key": "key", "language": "nl"},
        session=LocalizedSession(),
        now=lambda: 1000
    )

    details = client.fetch_series_details(121361)

    assert details["title"] == "Game of Thrones NL"
    assert details["overview"] == "Nederlandse omschrijving."
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
python -m pytest tests/test_tvdb_client.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'providers.tvdb_client'`.

- [ ] **Step 3: Implement TVDB client**

Create `providers/tvdb_client.py`:

```python
import time
import requests


TVDB_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
TVDB_TOKEN_REFRESH_SKEW_SECONDS = 24 * 60 * 60


class TVDBClient:
    def __init__(self, config, session=None, now=None):
        self.config = config or {}
        self.session = session or requests.Session()
        self.now = now or time.time
        self._token = None
        self._token_expires_at = 0

    @property
    def base_url(self):
        return str(self.config.get("base_url") or "https://api4.thetvdb.com/v4").rstrip("/")

    @property
    def language(self):
        return str(self.config.get("language") or "en").split("-")[0].lower()

    def enabled(self):
        return bool(self.config.get("enabled") and self.config.get("api_key"))

    def bearer_token(self):
        if not self.enabled():
            return None
        refresh_after = self.now() + TVDB_TOKEN_REFRESH_SKEW_SECONDS
        if self._token and self._token_expires_at > refresh_after:
            return self._token

        payload = {"apikey": self.config.get("api_key", "").strip()}
        pin = self.config.get("pin", "").strip()
        if pin:
            payload["pin"] = pin

        response = self.session.post(f"{self.base_url}/login", json=payload, timeout=10)
        response.raise_for_status()
        token = response.json().get("data", {}).get("token")
        if not token:
            return None

        self._token = f"Bearer {token}"
        self._token_expires_at = self.now() + TVDB_TOKEN_TTL_SECONDS
        return self._token

    def fetch_series_details(self, tvdb_id):
        auth = self.bearer_token()
        if not auth:
            return {}

        response = self.session.get(
            f"{self.base_url}/series/{int(tvdb_id)}/extended",
            headers={"Authorization": auth},
            params={"short": "false"},
            timeout=10,
        )
        response.raise_for_status()
        record = response.json().get("data") or {}
        translation = self.fetch_series_translation(tvdb_id, auth)
        if translation.get("name"):
            record["name"] = translation["name"]
        if translation.get("overview"):
            record["overview"] = translation["overview"]
        return normalize_tvdb_series(record)

    def fetch_series_translation(self, tvdb_id, auth):
        if self.language == "en":
            return {}
        response = self.session.get(
            f"{self.base_url}/series/{int(tvdb_id)}/translations/{self.language}",
            headers={"Authorization": auth},
            timeout=10,
        )
        if response.status_code != 200:
            return {}
        return response.json().get("data") or {}


def normalize_tvdb_series(record):
    tvdb_id = record.get("id")
    first_aired = record.get("firstAired") or ""
    runtime = record.get("averageRuntime")
    remote_ids = record.get("remoteIds") or []
    provider_ids = {"Tvdb": str(tvdb_id)} if tvdb_id else {}

    imdb_id = None
    for remote in remote_ids:
        source = str(remote.get("sourceName") or "").lower()
        remote_id = str(remote.get("id") or "").strip()
        if not remote_id:
            continue
        if "imdb" in source:
            imdb_id = remote_id
            provider_ids["Imdb"] = remote_id
        if "movie" in source or "tmdb" in source:
            provider_ids["Tmdb"] = remote_id

    content_ratings = record.get("contentRatings") or []
    official = next((item.get("name") for item in content_ratings if item.get("name")), None)

    artworks = sorted(record.get("artworks") or [], key=lambda item: item.get("score") or 0, reverse=True)
    backdrop_url = _pick_artwork(artworks, preferred_types={3, 15, 16, 22})
    logo_url = _pick_artwork(artworks, preferred_types={23, 24, 25})

    return {
        "id": f"tvdb-{tvdb_id}" if tvdb_id else None,
        "title": record.get("name"),
        "original_title": record.get("name"),
        "year": first_aired[:4] if first_aired else None,
        "rating": record.get("score"),
        "overview": record.get("overview") or "",
        "genres": ", ".join(g.get("name") for g in (record.get("genres") or []) if g.get("name")),
        "runtime": f"{runtime} min" if runtime else "",
        "backdrop_url": backdrop_url or record.get("image"),
        "logo_url": logo_url,
        "officialRating": official,
        "imdb_id": imdb_id,
        "provider_ids": provider_ids,
        "source": "TVDB",
    }


def _pick_artwork(artworks, preferred_types):
    for artwork in artworks:
        if artwork.get("type") in preferred_types and artwork.get("image"):
            return artwork["image"]
    return None
```

- [ ] **Step 4: Run tests**

Run:

```bash
python -m pytest tests/test_tvdb_client.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add providers/tvdb_client.py tests/test_tvdb_client.py
git commit -m "feat: add tvdb metadata client"
```

## Task 3: TV Metadata Routing

**Files:**
- Create: `providers/metadata_router.py`
- Create: `tests/test_media_routes.py`
- Modify: `gui_editor.py`
- Modify: `cron_runner.py`

- [ ] **Step 1: Add route-level tests**

Create `tests/test_media_routes.py`:

```python
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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
python -m pytest tests/test_media_routes.py::test_tmdb_item_uses_tvdb_when_tv_provider_is_tvdb -q
```

Expected: FAIL because `fetch_tvdb_details` and `apply_configured_rating` do not exist in `gui_editor.py`.

- [ ] **Step 3: Add metadata router**

Create `providers/metadata_router.py`:

```python
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
```

- [ ] **Step 4: Wire Flask metadata routing**

Modify `gui_editor.py` imports:

```python
from providers.metadata_router import choose_tv_metadata
from providers.tvdb_client import TVDBClient
from providers.ratings import apply_configured_rating
```

Add this helper after `fetch_tmdb_details`:

```python
def fetch_tvdb_details(tvdb_id, config):
    return TVDBClient(config.get("tvdb", {})).fetch_series_details(tvdb_id)


def enrich_media_metadata(metadata, media_type, config):
    routed = choose_tv_metadata(metadata, media_type, config)
    return apply_configured_rating(routed, config)
```

Change each path that returns TMDB details for a TV item to call:

```python
details = enrich_media_metadata(details, mtype, config)
```

For Trakt TV catalog items, use TMDB external IDs to discover `tvdb_id` and call `fetch_tvdb_details(tvdb_id, config)` when `metadata.tv_provider == "tvdb"`. If TVDB returns a title, set `source` to `"Trakt/TVDB"` and return the enriched result.

Modify `fetch_tmdb_details()` so returned `provider_ids` includes TMDB, IMDb, and TVDB when available:

```python
            "provider_ids": {
                "Tmdb": str(tmdb_id),
                "Imdb": imdb_id,
                "Tvdb": tvdb_id if media_type == "tv" else None,
            },
```

Remove `None` provider IDs before returning:

```python
        details["provider_ids"] = {k: v for k, v in details["provider_ids"].items() if v}
```

- [ ] **Step 5: Run test and commit**

Run:

```bash
python -m pytest tests/test_media_routes.py::test_tmdb_item_uses_tvdb_when_tv_provider_is_tvdb -q
```

Expected: PASS.

Commit:

```bash
git add providers/metadata_router.py tests/test_media_routes.py gui_editor.py cron_runner.py
git commit -m "feat: route tv metadata through tvdb"
```

## Task 4: Rating Provider Abstraction

**Files:**
- Create: `providers/ratings.py`
- Create: `tests/test_ratings.py`
- Modify: `gui_editor.py`
- Modify: `cron_runner.py`
- Modify: `render_task.js`

- [ ] **Step 1: Add failing rating tests**

Create `tests/test_ratings.py`:

```python
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python -m pytest tests/test_ratings.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'providers.ratings'`.

- [ ] **Step 3: Implement ratings provider**

Create `providers/ratings.py`:

```python
import requests


MDBLIST_PROVIDER_TO_API = {
    "mdblist_trakt": "trakt",
    "mdblist_tmdb": "tmdb",
    "mdblist_letterboxd": "letterboxd",
    "mdblist_tomatoes": "tomatoes",
    "mdblist_audience": "audience",
    "mdblist_metacritic": "metacritic",
}

RATING_LOGOS = {
    "tmdb": "tmdblogo.png",
    "imdb_api": "imdb_logo_2016.svg",
    "mdblist_trakt": "mdblist_trakt.svg",
    "mdblist_tmdb": "mdblist_tmdb.svg",
    "mdblist_letterboxd": "mdblist_letterboxd.svg",
    "mdblist_tomatoes": "mdblist_tomatoes.svg",
    "mdblist_audience": "mdblist_audience.png",
    "mdblist_metacritic": "mdblist_metacritic.png",
}


def apply_configured_rating(metadata, config):
    enriched = dict(metadata or {})
    provider = (config.get("ratings", {}) or {}).get("default_provider", "tmdb")
    enriched["rating_provider"] = provider
    enriched["rating_logo"] = RATING_LOGOS.get(provider, "imdb_logo_2016.svg")

    if provider == "tmdb":
        return enriched

    imdb_id = find_imdb_id(enriched)
    if not imdb_id:
        return enriched

    rating = None
    if provider.startswith("mdblist_"):
        rating = fetch_mdblist_rating(imdb_id, provider, enriched, config)
    elif provider == "imdb_api":
        rating = fetch_custom_imdb_rating(imdb_id, config)

    if rating is not None:
        enriched["rating"] = rating
    return enriched


def find_imdb_id(metadata):
    if metadata.get("imdb_id"):
        return metadata["imdb_id"]
    provider_ids = metadata.get("provider_ids") or {}
    for key in ("Imdb", "imdb", "imdb_id"):
        if provider_ids.get(key):
            return provider_ids[key]
    return None


def fetch_mdblist_rating(imdb_id, provider, metadata, config):
    mdblist = config.get("mdblist", {}) or {}
    if not mdblist.get("enabled") or not mdblist.get("api_key"):
        return None
    rating_type = MDBLIST_PROVIDER_TO_API.get(provider)
    if not rating_type:
        return None
    media_type = normalize_mdblist_media_type(metadata)
    url = f"https://api.mdblist.com/rating/{media_type}/{rating_type}?apikey={mdblist['api_key']}"
    response = requests.post(url, json={"ids": [imdb_id], "provider": "imdb"}, timeout=10)
    response.raise_for_status()
    first = (response.json().get("ratings") or [{}])[0]
    return first.get("rating")


def fetch_custom_imdb_rating(imdb_id, config):
    imdb = config.get("imdb_ratings", {}) or {}
    if not imdb.get("enabled") or not imdb.get("base_url") or not imdb.get("api_key"):
        return None
    base_url = str(imdb["base_url"]).rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    response = requests.get(
        f"{base_url}/ratings/{imdb_id}",
        headers={"X-API-Key": imdb["api_key"]},
        timeout=10,
    )
    response.raise_for_status()
    return response.json().get("averageRating")


def normalize_mdblist_media_type(metadata):
    raw = str(metadata.get("media_type") or metadata.get("type") or metadata.get("source_type") or "").lower()
    if raw in ("movie", "film"):
        return "movie"
    return "show"
```

- [ ] **Step 4: Apply rating enrichment in batch paths**

In `gui_editor.py`, ensure every `/api/media/item/<item_id>` branch returns `apply_configured_rating(...)` before `jsonify(...)`.

In `cron_runner.py`, import and apply:

```python
from providers.ratings import apply_configured_rating
```

Inside the processing loop before rendering:

```python
        meta = apply_configured_rating(meta, config)
```

In `run_node_renderer()`, include:

```python
        "rating_provider": metadata.get("rating_provider"),
        "rating_logo": metadata.get("rating_logo"),
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m pytest tests/test_ratings.py tests/test_media_routes.py -q
```

Expected: PASS.

Commit:

```bash
git add providers/ratings.py tests/test_ratings.py gui_editor.py cron_runner.py render_task.js
git commit -m "feat: add configurable rating providers"
```

## Task 5: Bundled Logos And Local Rating Rendering

**Files:**
- Create: `static/provider_logos/imdb_logo_2016.svg`
- Create: `static/provider_logos/mdblist_trakt.svg`
- Create: `static/provider_logos/mdblist_tmdb.svg`
- Create: `static/provider_logos/mdblist_letterboxd.svg`
- Create: `static/provider_logos/mdblist_tomatoes.svg`
- Create: `static/provider_logos/mdblist_audience.png`
- Create: `static/provider_logos/mdblist_metacritic.png`
- Modify: `static/js/editor.js`
- Modify: `render_task.js`

- [ ] **Step 1: Copy logos from Nexio**

Run:

```bash
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/raw/imdb_logo_2016.svg static/provider_logos/imdb_logo_2016.svg
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/raw/mdblist_trakt.svg static/provider_logos/mdblist_trakt.svg
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/raw/mdblist_tmdb.svg static/provider_logos/mdblist_tmdb.svg
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/raw/mdblist_letterboxd.svg static/provider_logos/mdblist_letterboxd.svg
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/raw/mdblist_tomatoes.svg static/provider_logos/mdblist_tomatoes.svg
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/drawable/mdblist_audience.png static/provider_logos/mdblist_audience.png
cp /Users/jneerdael/Scripts/nexio/app/src/main/res/drawable/mdblist_metacritic.png static/provider_logos/mdblist_metacritic.png
```

Expected: all seven files exist in `static/provider_logos/`.

- [ ] **Step 2: Replace broken IMDb URL in editor**

In `static/js/editor.js`, replace:

```javascript
const logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/IMDB_Logo_2016.svg/1200px-IMDB_Logo_2016.svg.png';
const proxiedUrl = `/api/proxy/image?url=${encodeURIComponent(logoUrl)}`;
fabric.Image.fromURL(proxiedUrl, function (img) {
```

with:

```javascript
const providerLogo = (lastFetchedData && lastFetchedData.rating_logo) ? lastFetchedData.rating_logo : 'imdb_logo_2016.svg';
const logoUrl = `/static/provider_logos/${providerLogo}`;
fabric.Image.fromURL(logoUrl, function (img) {
```

Keep the rest of the group creation logic unchanged.

- [ ] **Step 3: Make rating updates swap group logos**

In the `case 'rating':` branch inside `updateDynamicFields`, before setting text, add:

```javascript
const selectedRatingLogo = mediaData.rating_logo || 'imdb_logo_2016.svg';
```

When `obj.type === 'group'`, find the image child and update it:

```javascript
const logo = obj.getObjects().find(o => o.type === 'image');
if (logo && logo._element && !String(logo._element.src || '').includes(selectedRatingLogo)) {
    const logoUrl = `/static/provider_logos/${selectedRatingLogo}`;
    promises.push(new Promise(resolve => {
        fabric.Image.fromURL(logoUrl, function (img, isError) {
            if (!isError && img) {
                img.scaleToHeight(logo.getScaledHeight());
                img.set({ left: logo.left, top: logo.top, dataTag: 'rating_logo_img' });
                const children = obj.getObjects();
                const text = children.find(o => o.type === 'i-text');
                const replacement = text ? new fabric.Group([img, text], {
                    left: obj.left,
                    top: obj.top,
                    scaleX: obj.scaleX,
                    scaleY: obj.scaleY,
                    dataTag: 'rating'
                }) : null;
                if (replacement) {
                    canvas.remove(obj);
                    canvas.add(replacement);
                }
            }
            resolve();
        }, { crossOrigin: 'anonymous' });
    }));
}
```

- [ ] **Step 4: Mirror local logo behavior in Node renderer**

In `render_task.js`, update rating-logo logic so it reads:

```javascript
const ratingLogo = data.rating_logo || 'imdb_logo_2016.svg';
const logoPath = path.join(__dirname, 'static', 'provider_logos', ratingLogo);
```

Use this file path wherever the renderer currently hardcodes IMDb or fetches the external IMDb URL.

- [ ] **Step 5: Verify and commit**

Run:

```bash
test -f static/provider_logos/imdb_logo_2016.svg
test -f static/provider_logos/mdblist_tomatoes.svg
python -m pytest tests/test_ratings.py -q
```

Expected: both `test -f` commands exit 0 and pytest passes.

Commit:

```bash
git add static/provider_logos static/js/editor.js render_task.js
git commit -m "feat: bundle rating provider logos"
```

## Task 6: Trakt OAuth Client

**Files:**
- Create: `providers/trakt_client.py`
- Create: `tests/test_trakt_client.py`
- Modify: `gui_editor.py`
- Modify: `templates/editor.html`

- [ ] **Step 1: Add failing OAuth tests**

Create `tests/test_trakt_client.py`:

```python
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
                "interval": 5
            })
        return FakeResponse(200, {
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 604800
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python -m pytest tests/test_trakt_client.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'providers.trakt_client'`.

- [ ] **Step 3: Implement Trakt client**

Create `providers/trakt_client.py`:

```python
import time
from datetime import date
import requests


TRAKT_API_URL = "https://api.trakt.tv"
TRAKT_API_VERSION = "2"


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
        }
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
```

- [ ] **Step 4: Add Flask OAuth routes**

In `gui_editor.py`, add imports:

```python
from providers.trakt_client import TraktClient
```

Add routes near the existing Trakt test route:

```python
@gui_editor_bp.route('/api/trakt/oauth/start', methods=['POST'])
def trakt_oauth_start():
    config = load_config()
    client = TraktClient(config.get("trakt", {}))
    result = client.start_device_auth()
    save_config(config)
    return jsonify(result)


@gui_editor_bp.route('/api/trakt/oauth/poll', methods=['POST'])
def trakt_oauth_poll():
    config = load_config()
    client = TraktClient(config.get("trakt", {}))
    result = client.poll_device_auth()
    save_config(config)
    return jsonify(result)


@gui_editor_bp.route('/api/trakt/oauth/logout', methods=['POST'])
def trakt_oauth_logout():
    config = load_config()
    trakt = config.get("trakt", {})
    trakt.update({
        "access_token": "",
        "refresh_token": "",
        "expires_at": 0,
        "device_code": "",
        "user_code": "",
    })
    save_config(config)
    return jsonify({"status": "success"})
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m pytest tests/test_trakt_client.py -q
```

Expected: PASS.

Commit:

```bash
git add providers/trakt_client.py tests/test_trakt_client.py gui_editor.py templates/editor.html
git commit -m "feat: add trakt device oauth"
```

## Task 7: Trakt Catalog Fetching And Batch Source Mode

**Files:**
- Modify: `providers/trakt_client.py`
- Modify: `tests/test_trakt_client.py`
- Modify: `gui_editor.py`
- Modify: `static/js/batch.js`
- Modify: `templates/editor.html`

- [ ] **Step 1: Add catalog mapping tests**

Append to `tests/test_trakt_client.py`:

```python
def test_catalog_item_ids_are_normalized_for_tmdb_enrichment(monkeypatch):
    class CatalogSession(FakeSession):
        def get(self, url, headers=None, params=None, timeout=None):
            if url.endswith("/movies/trending"):
                return FakeResponse(200, [{"movie": {"title": "Dune", "year": 2021, "ids": {"tmdb": 438631, "imdb": "tt1160419"}}}])
            return super().get(url, headers=headers, params=params, timeout=timeout)

    config = {"client_id": "client", "access_token": "access", "expires_at": 999999999}
    client = TraktClient(config, session=CatalogSession(), now=lambda: 1000)

    items = client.fetch_catalog_items(["trakt_trending_movies"], limit=20)

    assert items == [{"Id": "trakt-movie-438631", "Name": "Dune", "catalog": "trakt_trending_movies"}]
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
python -m pytest tests/test_trakt_client.py::test_catalog_item_ids_are_normalized_for_tmdb_enrichment -q
```

Expected: FAIL because `fetch_catalog_items` does not exist.

- [ ] **Step 3: Implement catalog fetch methods**

Append to `providers/trakt_client.py`:

```python
TRAKT_CATALOG_ENDPOINTS = {
    "trakt_trending_movies": ("movies/trending", "movie"),
    "trakt_trending_shows": ("shows/trending", "show"),
    "trakt_popular_movies": ("movies/popular", "movie"),
    "trakt_popular_shows": ("shows/popular", "show"),
    "trakt_recommended_movies": ("recommendations/movies", "movie"),
    "trakt_recommended_shows": ("recommendations/shows", "show"),
}


def _catalog_title(item, media_type):
    media = item.get(media_type) if media_type in item else item
    return media.get("title") or media.get("name")


def _catalog_tmdb_id(item, media_type):
    media = item.get(media_type) if media_type in item else item
    return (media.get("ids") or {}).get("tmdb")


def _catalog_item_id(media_type, tmdb_id):
    tmdb_type = "movie" if media_type == "movie" else "tv"
    return f"trakt-{tmdb_type}-{tmdb_id}"
```

Add methods inside `TraktClient`:

```python
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
            user = (list_data.get("user") or {}).get("ids", {}).get("slug") or (list_data.get("user") or {}).get("username")
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
```

- [ ] **Step 4: Add catalog endpoints and batch UI**

In `gui_editor.py`, add:

```python
@gui_editor_bp.route('/api/trakt/catalogs')
def trakt_catalogs():
    config = load_config()
    client = TraktClient(config.get("trakt", {}))
    built_in = [
        {"id": "trakt_trending_movies", "title": "Trending Movies"},
        {"id": "trakt_trending_shows", "title": "Trending Shows"},
        {"id": "trakt_popular_movies", "title": "Popular Movies"},
        {"id": "trakt_popular_shows", "title": "Popular Shows"},
        {"id": "trakt_recommended_movies", "title": "Recommended Movies"},
        {"id": "trakt_recommended_shows", "title": "Recommended Shows"},
        {"id": "trakt_calendar_next_7_days", "title": "Calendar: Next 7 Days"},
    ]
    return jsonify({"built_in": built_in, "popular_lists": client.fetch_popular_lists()})


@gui_editor_bp.route('/api/trakt/catalog/items')
def trakt_catalog_items():
    config = load_config()
    catalog_ids = [c for c in request.args.get("catalogs", "").split(",") if c]
    limit = int(request.args.get("limit", "20") or 20)
    client = TraktClient(config.get("trakt", {}))
    return jsonify(client.fetch_catalog_items(catalog_ids, limit=limit))
```

In `templates/editor.html`, add a source mode:

```html
<option value="trakt_catalogs">Trakt Catalogs</option>
```

Add a selector block below provider selection:

```html
<div id="traktCatalogSelection" style="display:none; margin-top:10px;">
  <label>Trakt Catalogs</label>
  <div id="traktCatalogCheckboxes" style="display:flex; gap:10px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:8px; border-radius:4px; border:1px solid #444;"></div>
</div>
```

In `static/js/batch.js`, update `toggleBatchInputs()`:

```javascript
document.getElementById('traktCatalogSelection').style.display = (mode === 'trakt_catalogs') ? 'block' : 'none';
```

Add:

```javascript
async function loadTraktCatalogs() {
    const target = document.getElementById('traktCatalogCheckboxes');
    if (!target || target.dataset.loaded === 'true') return;
    const resp = await fetch('/api/trakt/catalogs');
    const data = await resp.json();
    const rows = [...data.built_in, ...data.popular_lists.map(l => ({ id: l.key, title: l.title }))];
    target.innerHTML = rows.map(row => `
        <label style="display:flex; align-items:center; gap:5px; font-size:11px; cursor:pointer; margin:0;">
            <input type="checkbox" name="traktCatalog" value="${row.id}" style="width:14px; height:14px; margin:0;">
            ${row.title}
        </label>
    `).join('');
    target.dataset.loaded = 'true';
}
```

At the start of `startBatchProcess()`, if `mode === 'trakt_catalogs'`, fetch items:

```javascript
if (mode === 'trakt_catalogs') {
    await loadTraktCatalogs();
    const selectedCatalogs = Array.from(document.querySelectorAll('input[name="traktCatalog"]:checked')).map(cb => cb.value);
    if (selectedCatalogs.length === 0) {
        logBatch("Select at least one Trakt catalog.");
        stopBatchProcess();
        return;
    }
    const limitVal = document.getElementById('batchMaxItems').value || '20';
    const resp = await fetch(`/api/trakt/catalog/items?catalogs=${encodeURIComponent(selectedCatalogs.join(','))}&limit=${encodeURIComponent(limitVal)}`);
    const list = await resp.json();
    if (list.error) { logBatch("Error: " + list.error); stopBatchProcess(); return; }
    itemsToProcess = list.map(i => ({ id: i.Id, name: i.Name }));
    logBatch(`Found ${itemsToProcess.length} Trakt catalog items.`);
}
```

Ensure the existing `library` block becomes `else if (mode === 'library')`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m pytest tests/test_trakt_client.py -q
```

Expected: PASS.

Commit:

```bash
git add providers/trakt_client.py tests/test_trakt_client.py gui_editor.py static/js/batch.js templates/editor.html
git commit -m "feat: add trakt catalog batch source"
```

## Task 8: Settings UI And Save Logic

**Files:**
- Modify: `templates/editor.html`
- Modify: `static/js/editor.js`
- Modify: `gui_editor.py`

- [ ] **Step 1: Add provider settings controls**

In `templates/editor.html`, add panels in the settings grid:

```html
<div class="settings-panel settings-compact-panel" id="set-group-metadata">
  <h3 onclick="toggleGroup('set-group-metadata')"><span class="group-arrow">▼</span> Metadata Routing</h3>
  <div class="group-content">
    <label for="set-movie-provider">Movie Metadata Provider</label>
    <select id="set-movie-provider">
      <option value="tmdb" {% if config.metadata.movie_provider == 'tmdb' %}selected{% endif %}>TMDB</option>
    </select>
    <label for="set-tv-provider">TV Metadata Provider</label>
    <select id="set-tv-provider">
      <option value="tmdb" {% if config.metadata.tv_provider == 'tmdb' %}selected{% endif %}>TMDB</option>
      <option value="tvdb" {% if config.metadata.tv_provider == 'tvdb' %}selected{% endif %}>TVDB</option>
    </select>
  </div>
</div>

<div class="settings-panel settings-compact-panel" id="set-group-tvdb">
  <h3 onclick="toggleGroup('set-group-tvdb')"><span class="group-arrow">▼</span> TVDB</h3>
  <div class="group-content">
    <label><input type="checkbox" id="set-tvdb-enabled" {% if config.tvdb.enabled %}checked{% endif %}> Enable TVDB</label>
    <label for="set-tvdb-key">TVDB API Key</label>
    <input type="password" id="set-tvdb-key" value="{{ config.tvdb.api_key }}">
    <label for="set-tvdb-pin">Subscriber PIN</label>
    <input type="password" id="set-tvdb-pin" value="{{ config.tvdb.pin }}">
    <label for="set-tvdb-lang">Language</label>
    <input type="text" id="set-tvdb-lang" value="{{ config.tvdb.language }}">
    <button onclick="testTvdbConnection()" style="margin-top:5px; width:100%;">Test TVDB</button>
  </div>
</div>

<div class="settings-panel settings-compact-panel" id="set-group-ratings">
  <h3 onclick="toggleGroup('set-group-ratings')"><span class="group-arrow">▼</span> Rating Provider</h3>
  <div class="group-content">
    <label for="set-rating-provider">Default rating used by Rating tags</label>
    <select id="set-rating-provider">
      <option value="tmdb" {% if config.ratings.default_provider == 'tmdb' %}selected{% endif %}>TMDB</option>
      <option value="imdb_api" {% if config.ratings.default_provider == 'imdb_api' %}selected{% endif %}>IMDb Ratings API</option>
      <option value="mdblist_trakt" {% if config.ratings.default_provider == 'mdblist_trakt' %}selected{% endif %}>MDBList Trakt</option>
      <option value="mdblist_tmdb" {% if config.ratings.default_provider == 'mdblist_tmdb' %}selected{% endif %}>MDBList TMDB</option>
      <option value="mdblist_letterboxd" {% if config.ratings.default_provider == 'mdblist_letterboxd' %}selected{% endif %}>MDBList Letterboxd</option>
      <option value="mdblist_tomatoes" {% if config.ratings.default_provider == 'mdblist_tomatoes' %}selected{% endif %}>MDBList Rotten Tomatoes</option>
      <option value="mdblist_audience" {% if config.ratings.default_provider == 'mdblist_audience' %}selected{% endif %}>MDBList Audience</option>
      <option value="mdblist_metacritic" {% if config.ratings.default_provider == 'mdblist_metacritic' %}selected{% endif %}>MDBList Metacritic</option>
    </select>
  </div>
</div>
```

Add MDBList and IMDb API panels:

```html
<div class="settings-panel settings-compact-panel" id="set-group-mdblist">
  <h3 onclick="toggleGroup('set-group-mdblist')"><span class="group-arrow">▼</span> MDBList</h3>
  <div class="group-content">
    <label><input type="checkbox" id="set-mdblist-enabled" {% if config.mdblist.enabled %}checked{% endif %}> Enable MDBList</label>
    <label for="set-mdblist-key">MDBList API Key</label>
    <input type="password" id="set-mdblist-key" value="{{ config.mdblist.api_key }}">
    <button onclick="testMdblistConnection()" style="margin-top:5px; width:100%;">Test MDBList</button>
  </div>
</div>

<div class="settings-panel settings-compact-panel" id="set-group-imdb-api">
  <h3 onclick="toggleGroup('set-group-imdb-api')"><span class="group-arrow">▼</span> IMDb Ratings API</h3>
  <div class="group-content">
    <label><input type="checkbox" id="set-imdb-api-enabled" {% if config.imdb_ratings.enabled %}checked{% endif %}> Enable IMDb Ratings API</label>
    <label for="set-imdb-api-url">Base URL</label>
    <input type="text" id="set-imdb-api-url" value="{{ config.imdb_ratings.base_url }}">
    <label for="set-imdb-api-key">API Key</label>
    <input type="password" id="set-imdb-api-key" value="{{ config.imdb_ratings.api_key }}">
    <button onclick="testImdbRatingsConnection()" style="margin-top:5px; width:100%;">Test IMDb API</button>
  </div>
</div>
```

- [ ] **Step 2: Persist new settings**

In `static/js/editor.js`, add to `saveSettings()` config object:

```javascript
metadata: {
    movie_provider: document.getElementById('set-movie-provider').value,
    tv_provider: document.getElementById('set-tv-provider').value
},
tvdb: {
    enabled: document.getElementById('set-tvdb-enabled').checked,
    base_url: 'https://api4.thetvdb.com/v4',
    api_key: document.getElementById('set-tvdb-key').value,
    pin: document.getElementById('set-tvdb-pin').value,
    language: document.getElementById('set-tvdb-lang').value
},
mdblist: {
    enabled: document.getElementById('set-mdblist-enabled').checked,
    api_key: document.getElementById('set-mdblist-key').value,
    show_trakt: true,
    show_tmdb: true,
    show_letterboxd: true,
    show_tomatoes: true,
    show_audience: true,
    show_metacritic: true
},
imdb_ratings: {
    enabled: document.getElementById('set-imdb-api-enabled').checked,
    base_url: document.getElementById('set-imdb-api-url').value,
    api_key: document.getElementById('set-imdb-api-key').value
},
ratings: {
    default_provider: document.getElementById('set-rating-provider').value
},
```

In the `currentConfig` merge block, add:

```javascript
currentConfig.metadata = config.metadata;
currentConfig.tvdb = config.tvdb;
currentConfig.mdblist = config.mdblist;
currentConfig.imdb_ratings = config.imdb_ratings;
currentConfig.ratings = config.ratings;
```

- [ ] **Step 3: Add connection test routes**

In `gui_editor.py`, add:

```python
@gui_editor_bp.route('/api/test/tvdb', methods=['POST'])
def test_tvdb():
    data = request.json or {}
    client = TVDBClient({
        "enabled": True,
        "base_url": data.get("base_url") or "https://api4.thetvdb.com/v4",
        "api_key": data.get("api_key", ""),
        "pin": data.get("pin", ""),
    })
    token = client.bearer_token()
    if token:
        return jsonify({"status": "success", "message": "Connected to TVDB"})
    return jsonify({"status": "error", "message": "TVDB token was not returned"}), 400


@gui_editor_bp.route('/api/test/mdblist', methods=['POST'])
def test_mdblist():
    data = request.json or {}
    api_key = data.get("api_key", "")
    if not api_key:
        return jsonify({"status": "error", "message": "API Key required"}), 400
    try:
        r = requests.get("https://api.mdblist.com/user", params={"apikey": api_key}, timeout=5)
        r.raise_for_status()
        return jsonify({"status": "success", "message": "Connected to MDBList"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@gui_editor_bp.route('/api/test/imdb-ratings', methods=['POST'])
def test_imdb_ratings():
    data = request.json or {}
    base_url = str(data.get("base_url", "")).rstrip("/")
    api_key = data.get("api_key", "")
    if not base_url or not api_key:
        return jsonify({"status": "error", "message": "Base URL and API Key required"}), 400
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    try:
        r = requests.get(f"{base_url}/meta/stats", headers={"X-API-Key": api_key}, timeout=5)
        r.raise_for_status()
        return jsonify({"status": "success", "message": "Connected to IMDb Ratings API"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
```

- [ ] **Step 4: Add browser-side test functions**

In `templates/editor.html`, near existing `testTraktConnection()`:

```javascript
function testTvdbConnection() {
    fetch('/api/test/tvdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: document.getElementById('set-tvdb-key').value,
            pin: document.getElementById('set-tvdb-pin').value,
            base_url: 'https://api4.thetvdb.com/v4'
        })
    }).then(r => r.json()).then(data => alert(data.status === 'success' ? "OK " + data.message : "Error: " + data.message))
      .catch(() => alert("Network Error"));
}

function testMdblistConnection() {
    fetch('/api/test/mdblist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: document.getElementById('set-mdblist-key').value })
    }).then(r => r.json()).then(data => alert(data.status === 'success' ? "OK " + data.message : "Error: " + data.message))
      .catch(() => alert("Network Error"));
}

function testImdbRatingsConnection() {
    fetch('/api/test/imdb-ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            base_url: document.getElementById('set-imdb-api-url').value,
            api_key: document.getElementById('set-imdb-api-key').value
        })
    }).then(r => r.json()).then(data => alert(data.status === 'success' ? "OK " + data.message : "Error: " + data.message))
      .catch(() => alert("Network Error"));
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m pytest tests -q
```

Expected: PASS.

Commit:

```bash
git add templates/editor.html static/js/editor.js gui_editor.py
git commit -m "feat: add provider settings controls"
```

## Task 9: Cron And Server-Side Batch Parity

**Files:**
- Modify: `cron_runner.py`
- Modify: `static/js/editor.js`
- Modify: `templates/editor.html`

- [ ] **Step 1: Add cron Trakt catalog shape**

In `static/js/editor.js`, update `addCronJob()` so it stores:

```javascript
const sourceMode = document.getElementById('cronSourceMode') ? document.getElementById('cronSourceMode').value : 'library';
const selectedTraktCatalogs = Array.from(document.querySelectorAll('input[name="traktCatalog"]:checked')).map(cb => cb.value);
```

Add to the job payload:

```javascript
source_mode: sourceMode,
trakt_catalogs: selectedTraktCatalogs,
```

- [ ] **Step 2: Implement cron catalog fetching**

In `cron_runner.py`, import:

```python
from providers.trakt_client import TraktClient
```

Replace `fetch_trakt_cron()` with:

```python
def fetch_trakt_cron(config, job):
    trakt_config = config.get('trakt', {})
    client = TraktClient(trakt_config)
    limit = int(job.get('limit') or job.get('random_count') or 20)
    catalog_ids = job.get('trakt_catalogs') or trakt_config.get('catalogs', {}).get('enabled', [])
    list_items = client.fetch_catalog_items(catalog_ids, limit=limit)
    meta_items = []
    for item in list_items:
        item_id = item.get("Id", "")
        parts = item_id.split("-")
        if len(parts) >= 3 and parts[0] == "trakt":
            media_type = "tv" if parts[1] == "tv" else "movie"
            tmdb_id = parts[2]
            details = fetch_tmdb_details(tmdb_id, media_type, config)
            if details:
                details["source"] = "Trakt"
                meta_items.append(details)
    return meta_items
```

- [ ] **Step 3: Ensure ratings and TVDB apply to cron output**

In `fetch_trakt_cron()`, after `details = fetch_tmdb_details(...)`, route TV metadata and ratings:

```python
                details = choose_tv_metadata(details, media_type, config)
                details = apply_configured_rating(details, config)
```

Add imports:

```python
from providers.metadata_router import choose_tv_metadata
from providers.ratings import apply_configured_rating
```

- [ ] **Step 4: Manual cron dry-run command**

Run a dry-run forced cron job after implementing UI support by temporarily saving a job with `dry_run: true` and `force_run: true`, then:

```bash
python cron_runner.py
```

Expected log: `Processing N items from trakt...` followed by `[Dry Run] Processing: ...` lines for catalog items.

- [ ] **Step 5: Commit**

```bash
git add cron_runner.py static/js/editor.js templates/editor.html
git commit -m "feat: support trakt catalogs in cron jobs"
```

## Task 10: Docker, Docs, And Verification

**Files:**
- Modify: `Dockerfile`
- Modify: `README.md`

- [ ] **Step 1: Ensure provider logos ship in Docker defaults**

In `Dockerfile`, extend the defaults copy block:

```dockerfile
RUN mkdir -p /defaults && \
    if [ -d "overlays" ]; then cp -r overlays /defaults/; fi && \
    if [ -d "textures" ]; then cp -r textures /defaults/; fi && \
    if [ -d "fonts" ]; then cp -r fonts /defaults/; fi && \
    if [ -d "custom_icons" ]; then cp -r custom_icons /defaults/; fi && \
    if [ -d "static/provider_logos" ]; then mkdir -p /defaults/static && cp -r static/provider_logos /defaults/static/; fi
```

- [ ] **Step 2: Update README provider section**

Add this under `Provider Settings`:

```markdown
TV Background Suite can use different services for catalog discovery, metadata, and ratings.

- TMDB remains the default movie metadata provider.
- TVDB can be enabled as the TV metadata provider for series details and artwork.
- Rating tags can use TMDB, MDBList providers, or a custom IMDb Ratings API.
- Trakt supports OAuth device login and catalog batch generation for trending, popular, recommended, calendar, and selected popular-list catalogs.
```

Add this under `Batch Processing`:

```markdown
For Trakt catalog batches, choose **Trakt Catalogs** as the source mode, select one or more catalogs, choose a layout, and start the batch. The same renderer and gallery output are used as library batches.
```

- [ ] **Step 3: Run Python unit tests**

Run:

```bash
python -m pytest tests -q
```

Expected: PASS.

- [ ] **Step 4: Run a syntax check**

Run:

```bash
python -m py_compile gui_editor.py cron_runner.py providers/config_schema.py providers/tvdb_client.py providers/metadata_router.py providers/ratings.py providers/trakt_client.py
```

Expected: no output and exit code 0.

- [ ] **Step 5: Verify Node renderer still starts**

Run:

```bash
node render_task.js
```

Expected: exit code 1 with usage text:

```text
Usage: node render_task.js <layout_json_path> <output_base_path> <data_json_string_or_path>
```

- [ ] **Step 6: Build Docker image**

Run:

```bash
docker build -t tvbgsuite-provider-integrations .
```

Expected: image builds successfully.

- [ ] **Step 7: Run local server smoke test**

Run:

```bash
python gui_editor.py
```

Open `http://127.0.0.1:5000/editor`.

Expected:

- Settings tab shows Metadata Routing, TVDB, MDBList, IMDb Ratings API, and Rating Provider panels.
- Batch tab shows Trakt Catalogs as a source mode.
- Choosing Trakt Catalogs shows catalog checkboxes.
- Adding a Rating tag uses `/static/provider_logos/imdb_logo_2016.svg` instead of the previous external IMDb URL.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile README.md
git commit -m "docs: document provider integrations"
```

## Self-Review

Spec coverage:

- TVDB for TV content: Tasks 1, 2, 3, 8, and 9 add config, client, metadata routing, settings UI, and cron parity.
- TVDB localization: Task 2 loads `/series/{id}/translations/{language}` and Task 8 exposes the language setting.
- MDBList ratings: Tasks 1, 4, 5, and 8 add config, API client behavior, logos, and settings UI.
- Custom IMDb Ratings API: Tasks 1, 4, 5, and 8 add config, API client behavior, local IMDb logo, and settings UI.
- Rating provider selection in configuration menu: Task 8 adds the selector and Task 4 makes it drive rendering metadata.
- Default logos instead of broken IMDb link: Task 5 copies Nexio assets and replaces the external URL.
- Better Trakt integration with full OAuth: Task 6 adds device OAuth, token persistence, refresh, and logout.
- Batch wallpapers from Trakt catalogs: Task 7 adds catalog APIs and UI source mode; Task 9 adds cron parity.
- Built-in and popular Trakt catalogs: Task 7 implements trending, popular, recommended, calendar, and popular-list item catalogs.
- Removed integrations: Task 0 removes Jellyfin, Plex, Radarr, Sonarr, and Jellyseerr from config, UI, batch, cron, and routes.

Placeholder scan:

- The plan contains no implementation placeholders. Every code edit names concrete files, functions, routes, config keys, and commands.

Type consistency:

- Config uses `imdb_ratings` for custom IMDb API settings across Python and JavaScript.
- Rating provider values are stable: `tmdb`, `imdb_api`, and `mdblist_*`.
- Source providers are stable: `tmdb` and `trakt`.
- Metadata providers are stable: `tmdb` for movies and `tvdb` as the TV option.
- Trakt catalog IDs match Nexio IDs where applicable.
- Normalized media dictionaries continue using existing keys: `title`, `year`, `rating`, `overview`, `genres`, `runtime`, `backdrop_url`, `logo_url`, `officialRating`, `imdb_id`, `provider_ids`, and `source`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-tvdb-mdblist-imdb-trakt-providers.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
