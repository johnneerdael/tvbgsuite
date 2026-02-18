import os
import sys
import time
import argparse
import json
import requests
import subprocess
import tempfile
import base64
from urllib.parse import quote
from datetime import datetime

# Path to own module folder
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from gui_editor import load_config, save_config

# Config
API_URL = "http://127.0.0.1:5000/api/save_image"
LOG_URL = "http://127.0.0.1:5000/api/cron/log"
STOP_SIGNAL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cron_stop.signal')

def log(msg):
    print(msg)
    try:
        requests.post(LOG_URL, json={"message": msg}, timeout=1)
    except:
        pass

# --- START DER ANGEPASSTEN FUNKTION ---
# Diese Funktion ist jetzt viel kürzer und effizienter.
# Sie übergibt die Anweisungen direkt an Node.js, anstatt Bilder selbst herunterzuladen.
def run_node_renderer(layout_path, metadata, output_base_path):
    # 1. Daten-Payload als JSON-String vorbereiten
    data_payload = {
        "title": metadata.get('title'),
        "year": metadata.get('year'),
        "overview": metadata.get('overview'),
        "genres": metadata.get('genres'),
        "runtime": metadata.get('runtime'),
        "rating": metadata.get('rating'),
        "officialRating": metadata.get('officialRating'),
        "actors": metadata.get('actors', []),
        "directors": metadata.get('directors', []),
        "source": "Jellyfin",
        "backdrop_url": metadata.get('backdrop_url'),
        "logo_url": metadata.get('logo_url')
    }
    data_json_string = json.dumps(data_payload, ensure_ascii=False)

    # 2. Erwartete Ausgabepfade definieren
    output_image_path = f"{output_base_path}.jpg"
    output_json_path = f"{output_base_path}.json"
    output_ambilight_path = f"{output_base_path}.ambilight.jpg"

    # 3. Node.js-Prozess ausführen
    image_b64 = None
    ambilight_b64 = None
    final_json = None
    
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        script_path = os.path.join(script_dir, 'render_task.js')
        
        # Der neue, korrekte Befehl mit drei Argumenten
        cmd = [
            'node',
            script_path,
            layout_path,
            output_base_path,
            data_json_string
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', cwd=script_dir)
        
        log(f"--- NODE.JS OUTPUT (Exit Code: {result.returncode}) ---")
        if result.stdout: log(f"STDOUT: {result.stdout.strip()}")
        if result.stderr: log(f"STDERR: {result.stderr.strip()}")
        log("--------------------------------------------------")

        if result.returncode == 0:
            if os.path.exists(output_image_path):
                with open(output_image_path, 'rb') as f:
                    image_b64 = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"
            
            if os.path.exists(output_ambilight_path):
                with open(output_ambilight_path, 'rb') as f:
                    ambilight_b64 = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"
            
            if os.path.exists(output_json_path):
                with open(output_json_path, 'r', encoding='utf-8') as f:
                    final_json = json.load(f)
        else:
            log("--- NODE.JS CRASH REPORT --- (Details siehe oben)")

    except Exception as e:
        log(f"Render Execution Error: {e}")
    
    finally:
        # Temporäre Dateien, die von Node.js erstellt wurden, aufräumen
        for p in [output_image_path, output_json_path, output_ambilight_path]:
            if p and os.path.exists(p):
                try: os.remove(p)
                except: pass

    # preferred_logo_width wird nicht mehr zurückgegeben
    return image_b64, ambilight_b64, final_json, None
# --- ENDE DER ANGEPASSTEN FUNKTION ---

def fetch_items_and_process(job=None):
    if not job: return
    
    job_name = job.get('name', 'Unnamed Job')
    log(f"Starting Cron Job: {job_name}")
    
    config = load_config()
    
    layout_dir = os.path.join(os.path.dirname(__file__), 'layouts')
    layout_name = job.get('layout_name', 'Default')
    layout_full_path = os.path.join(layout_dir, f"{layout_name}.json")
    
    if not os.path.exists(layout_full_path):
        log(f"Layout not found: {layout_name}")
        return

    log(f"Using Layout: {layout_name}")

    jf = config.get('jellyfin', {})
    if not jf.get('url'): return

    headers = {"X-Emby-Token": jf['api_key']}
    base_url = jf['url'].rstrip('/')
    
    boxset_ids = set()
    try:
        bs_url = f"{base_url}/Users/{jf['user_id']}/Items?IncludeItemTypes=BoxSet&Recursive=true&Fields=Id"
        r_bs = requests.get(bs_url, headers=headers, timeout=10)
        if r_bs.status_code == 200:
            for b in r_bs.json().get('Items', []):
                boxset_ids.add(b['Id'])
    except Exception as e:
        log(f"Error fetching BoxSets: {e}")

    source_mode = job.get('source_mode', 'library')
    filter_mode = job.get('filter_mode', 'all')
    filter_val = job.get('filter_value', '')
    item_types = job.get('item_types', 'Movie,Series')
    limit_count = job.get('limit', '0')
    
    params = [
        f"IncludeItemTypes={item_types}",
        "Recursive=true",
        "ExcludeItemTypes=BoxSet",
        "Fields=Overview,Genres,OfficialRating,CommunityRating,ProviderIds,ProductionYear,RunTimeTicks,OriginalTitle,Tags,Studios,InheritedParentalRatingValue,ImageTags,ParentId,People"
    ]
    
    if source_mode == 'random':
        limit = int(job.get('random_count', 10))
        params.append("SortBy=Random")
        params.append(f"Limit={limit}")
    else:
        if limit_count and limit_count != '0':
            params.append(f"Limit={limit_count}")
        else:
            params.append("Limit=100000")
            
        if filter_mode == 'recent':
            params.append("SortBy=DateCreated")
            params.append("SortOrder=Descending")
        elif filter_mode == 'year' and filter_val:
            params.append("SortBy=SortName")
            params.append(f"Years={filter_val}")
        elif filter_mode == 'genre' and filter_val:
            params.append("SortBy=SortName")
            params.append(f"Genres={filter_val}")
        elif filter_mode == 'rating':
            params.append("SortBy=CommunityRating")
            params.append("SortOrder=Descending")
            if filter_val: params.append(f"MinCommunityRating={filter_val}")
        else:
            params.append("SortBy=SortName")

    query_string = "&".join(params)
    url = f"{base_url}/Users/{jf['user_id']}/Items?{query_string}"
    
    try:
        req = requests.get(url, headers=headers)
        items = req.json().get('Items', [])
    except Exception as e:
        log(f"Jellyfin Error: {e}")
        return

    log(f"Processing {len(items)} items...")

    for item in items:
        if os.path.exists(STOP_SIGNAL_FILE): break
        
        if job.get('id'):
            try:
                curr_conf = load_config()
                curr_jobs = curr_conf.get('cron_jobs', [])
                active = next((j for j in curr_jobs if j.get('id') == job['id']), None)
                if not active:
                    log(f"Job {job.get('name')} was deleted. Stopping.")
                    break
                if not active.get('enabled', True):
                    log(f"Job {job.get('name')} was disabled. Stopping.")
                    break
            except:
                pass

        safe_title = "".join(c for c in item.get('Name', '') if c.isalnum() or c in " ._-").strip()
        
        if job.get('dry_run'):
            log(f"[Dry Run] Processing: {safe_title}")
            continue
            
        output_base_name = f"{safe_title} - {item.get('ProductionYear')}"
        filename_for_api = f"{output_base_name}.jpg"

        if not job.get('overwrite', False):
            base_path = os.path.dirname(os.path.abspath(__file__))
            target_dir = os.path.join(base_path, 'editor_backgrounds', layout_name)
            expected_path = os.path.join(target_dir, filename_for_api)
            if os.path.exists(expected_path):
                log(f"Skipping {safe_title} (Exists)")
                continue
        
        ticks = item.get('RunTimeTicks', 0)
        minutes = (ticks // 600000000) if ticks else 0
        h, m = divmod(minutes, 60)
        runtime = f"{h}h {m}min" if h > 0 else f"{m}min"
        
        is_in_boxset = item.get('ParentId') in boxset_ids

        meta = {
            "title": item.get('Name'),
            "year": item.get('ProductionYear'),
            "overview": item.get('Overview'),
            "rating": item.get('CommunityRating'),
            "officialRating": item.get('OfficialRating'),
            "genres": ", ".join(item.get('Genres', [])),
            "runtime": runtime,
            "backdrop_url": f"{base_url}/Items/{item['Id']}/Images/Backdrop?api_key={jf['api_key']}",
            "logo_url": None if is_in_boxset else (f"{base_url}/Items/{item['Id']}/Images/Logo?api_key={jf['api_key']}" if 'Logo' in item.get('ImageTags', {}) else None),
            "action_url": f"jellyfin://items/{item['Id']}",
            "provider_ids": item.get('ProviderIds', {}),
            "actors": [p.get('Name') for p in item.get('People', []) if p.get('Type') == 'Actor'],
            "directors": (
                list(dict.fromkeys(p.get('Name') for p in item.get('People', []) if p.get('Type') == 'Director'))
                or list(dict.fromkeys(p.get('Name') for p in item.get('People', []) if p.get('Type') == 'Writer'))
            )
        }

        log(f"Rendering: {meta['title']}")

        # Der Aufruf erfolgt jetzt in einem temporären Verzeichnis
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_output_base_path = os.path.join(temp_dir, 'output')
            img_b64, ambilight_b64, json_data, _ = run_node_renderer(layout_full_path, meta, temp_output_base_path)

            if img_b64 and json_data:
                payload = {
                    "image": img_b64,
                    "layout_name": layout_name,
                    "metadata": meta,
                    "canvas_json": json_data,
                    "overwrite_filename": filename_for_api,
                    "target_type": "gallery"
                }
                
                if ambilight_b64:
                    payload['ambilight_image_data'] = ambilight_b64
                    
                try:
                    requests.post(API_URL, json=payload)
                except Exception as e:
                    log(f"Upload failed: {e}")
            else:
                log("Rendering failed.")

    log("Batch Finished.")

def run_scheduler():
    log("Scheduler Mode Started")
    last_run_minute = -1

    while True:
        if os.path.exists(STOP_SIGNAL_FILE):
            log("Stop signal received. Exiting scheduler.")
            os.remove(STOP_SIGNAL_FILE)
            break
            
        try:
            config = load_config()
            jobs = config.get('cron_jobs', [])
            
            for i, job in enumerate(jobs):
                if not job.get('enabled', True): continue

                if job.get('force_run'):
                    log(f"Force Run triggered for: {job.get('name')}")
                    fetch_items_and_process(job)
                    jobs[i]['force_run'] = False
                    config['cron_jobs'] = jobs
                    save_config(config)
                    continue

                now = datetime.now()
                start_str = job.get('start_time', '00:00')
                try:
                    start_h, start_m = map(int, start_str.split(':'))
                except:
                    start_h, start_m = 0, 0
                
                freq = int(job.get('frequency', 1))
                if freq < 1: freq = 1
                
                interval_minutes = (24 * 60) / freq
                start_total_minutes = start_h * 60 + start_m
                current_total_minutes = now.hour * 60 + now.minute
                
                for k in range(freq):
                    target = (start_total_minutes + (k * interval_minutes)) % (24 * 60)
                    if int(target) == current_total_minutes:
                        if last_run_minute != current_total_minutes:
                            log(f"Schedule Trigger: {job.get('name')}")
                            fetch_items_and_process(job)
                            last_run_minute = current_total_minutes
                        break
        except Exception as e:
            log(f"Scheduler Error: {e}")
        
        time.sleep(10)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--scheduler', action='store_true', help='Run in scheduler mode')
    args = parser.parse_args()
    
    if args.scheduler:
        run_scheduler()
    else:
        config = load_config()
        jobs = config.get('cron_jobs', [])
        for i, job in enumerate(jobs):
            if job.get('force_run'):
                fetch_items_and_process(job)
                jobs[i]['force_run'] = False
                config['cron_jobs'] = jobs
                save_config(config)
        
        if os.path.exists(STOP_SIGNAL_FILE):
            os.remove(STOP_SIGNAL_FILE)