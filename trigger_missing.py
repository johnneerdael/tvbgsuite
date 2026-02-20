import requests
import os
import json
import time
from dotenv import load_dotenv

# --- CONFIGURATION LOAD ---
# Lädt Variablen aus deiner existierenden .env Datei
load_dotenv(verbose=True)

# Lade config.json Logik (aus deinem Skript übernommen)
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
config = {}
if os.path.exists(CONFIG_FILE):
    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
    except: pass

def get_conf(service, key, env_var):
    return config.get(service, {}).get(key) or os.getenv(env_var)

SONARR_URL = get_conf('sonarr', 'url', 'SONARR_URL')
SONARR_API_KEY = get_conf('sonarr', 'api_key', 'SONARR_API_KEY')
RADARR_URL = get_conf('radarr', 'url', 'RADARR_URL')
RADARR_API_KEY = get_conf('radarr', 'api_key', 'RADARR_API_KEY')

# Safety delay between search requests (in seconds) to prevent API rate limiting
DELAY_SECONDS = 3

def get_sonarr_missing_episodes(logger=print):
    """Fetches all missing episodes from Sonarr."""
    if not SONARR_URL or not SONARR_API_KEY:
        logger("Error: SONARR_URL or API_KEY is missing.")
        return []

    endpoint = f"{SONARR_URL}/api/v3/wanted/missing"
    headers = {"X-Api-Key": SONARR_API_KEY}
    params = {
        "pageSize": 10000,
        "sortKey": "airDateUtc",
        "sortDirection": "descending",
        "includeSeries": "true"
    }

    try:
        logger(f"[Sonarr] Fetching missing episodes list...")
        response = requests.get(endpoint, headers=headers, params=params)
        response.raise_for_status()
        return response.json().get('records', [])
    except requests.exceptions.RequestException as e:
        logger(f"[Sonarr] Error fetching list: {e}")
        return []

def trigger_sonarr_season_search(series_id, season_number, logger=print):
    """Sends the SeasonSearch command to Sonarr."""
    endpoint = f"{SONARR_URL}/api/v3/command"
    headers = {"X-Api-Key": SONARR_API_KEY}
    payload = {
        "name": "SeasonSearch",
        "seriesId": series_id,
        "seasonNumber": season_number
    }

    try:
        response = requests.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger(f"[Sonarr] Error sending search command: {e}")
        return None

def run_sonarr_batch_search(logger=print):
    """
    Main logic for Sonarr:
    1. Get missing episodes
    2. Group them by season (Series + Season Number)
    3. Trigger a SeasonSearch for each group
    """
    records = get_sonarr_missing_episodes(logger)
    
    if not records:
        logger("[Sonarr] No missing episodes found.")
        return

    # Use a Set to store unique combinations of (SeriesID, SeasonNumber)
    seasons_to_search = set()

    for item in records:
        s_id = item.get('seriesId')
        s_num = item.get('seasonNumber')
        
        title = "Unknown Series"
        if 'series' in item and 'title' in item['series']:
            title = item['series']['title']
        
        if s_id is not None and s_num is not None:
            seasons_to_search.add((s_id, s_num, title))

    logger(f"[Sonarr] Found {len(records)} missing episodes grouped into {len(seasons_to_search)} unique seasons.")
    logger("-" * 50)

    # Iterate through the unique set and trigger searches
    for i, (s_id, s_num, title) in enumerate(seasons_to_search, 1):
        logger(f"[{i}/{len(seasons_to_search)}] Searching: {title} - Season {s_num:02d}")
        
        trigger_sonarr_season_search(s_id, s_num, logger)
        
        # Pause to be polite to the server/indexer
        if i < len(seasons_to_search):
            time.sleep(DELAY_SECONDS)

    logger("-" * 50)

def trigger_radarr_missing_search(logger=print):
    """Starts the global 'MissingMoviesSearch' command for Radarr."""
    if not RADARR_URL or not RADARR_API_KEY:
        logger("Error: RADARR_URL or API_KEY is missing.")
        return

    endpoint = f"{RADARR_URL}/api/v3/command"
    headers = {"X-Api-Key": RADARR_API_KEY}
    payload = {"name": "MissingMoviesSearch"}

    logger(f"\n[Radarr] Starting 'MissingMoviesSearch' command...")
    try:
        response = requests.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        logger(f"[Radarr] Search started successfully (Job ID: {response.json().get('id')})")
    except requests.exceptions.RequestException as e:
        logger(f"[Radarr] Error: {e}")

if __name__ == "__main__":
    print("=== STARTING BATCH SEARCH ===")
    run_sonarr_batch_search()
    trigger_radarr_missing_search()
    print("=== FINISHED ===")