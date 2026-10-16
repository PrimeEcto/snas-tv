#!/usr/bin/env python3
"""D-pad-only checks for the final TV redesign against an installed Android APK.

Run only after the standard journey releases the emulator. Native screenshots and
accessibility trees are evidence; this script never sends host UI input.
Use SNAS_GENRES_ONLY=1 for expanded-genre checks and a separate evidence directory.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
GENRES_ONLY = os.environ.get('SNAS_GENRES_ONLY') == '1'
OUT = ROOT / ('research/v003/genres-extended' if GENRES_ONLY else 'research/v003/final-extended')
OUT.mkdir(parents=True, exist_ok=True)
ADB = os.environ.get('ADB', '/opt/android-sdk/platform-tools/adb')
SERIAL = os.environ.get('ANDROID_SERIAL', 'emulator-5556')
GENRES_RESUME = GENRES_ONLY and os.environ.get('SNAS_GENRES_RESUME') == 'series'
RESUME = not GENRES_ONLY and bool(os.environ.get('SNAS_EXTENDED_RESUME'))
ROWS = json.loads((OUT / 'results.json').read_text()) if (RESUME or GENRES_RESUME) and (OUT / 'results.json').exists() else []
if GENRES_RESUME:
    ROWS = [row for row in ROWS if row['result'] == 'PASS' and not row['journey'].startswith('Series')]
# The final shell puts the Search and Settings icons after the four text tabs.
# Settings retains nav-About as its stable automation ID.
TABS = ['Home', 'Movies', 'Series', 'My List', 'Search', 'About']
SETTING_ROWS = {'player-quality', 'player-aspect', 'player-speed'}
INITIAL_ENVIRONMENT = {}


def adb(*args):
    return subprocess.check_output([ADB, '-s', SERIAL, *args], timeout=40)


def key(name, count=1):
    code = name if name in ['BACK', 'MEDIA_PLAY_PAUSE'] else 'DPAD_' + name
    for _ in range(count):
        adb('shell', 'input', 'keyevent', 'KEYCODE_' + code)
        time.sleep(.18)


def tree(name='state'):
    for attempt in range(3):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/snas-extended.xml')
            raw = adb('shell', 'cat', '/sdcard/snas-extended.xml')
            nodes = list(ET.fromstring(raw).iter('node'))
            (OUT / (name + '.xml')).write_bytes(raw)
            return nodes
        except (subprocess.SubprocessError, ET.ParseError):
            if attempt == 2:
                raise
            time.sleep(.5)


def ident(node):
    return node.get('resource-id', '').split(':id/')[-1]


def current(nodes):
    return next((ident(n) for n in nodes if n.get('focused') == 'true'), '')


def has(nodes, value):
    return any(value in n.get('text', '') or value in n.get('content-desc', '') for n in nodes)


def node_by_id(nodes, wanted):
    return next((n for n in nodes if ident(n) == wanted), None)


def has_id(nodes, wanted):
    return node_by_id(nodes, wanted) is not None


def selected(node):
    return node is not None and (node.get('checked') == 'true' or node.get('selected') == 'true')


def box(node):
    x1, y1, x2, y2 = map(int, re.findall(r'-?\d+', node.get('bounds', '[0,0][0,0]')))
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def focus(wanted, scroll_direction='DOWN'):
    seen = {}
    for _ in range(40):
        nodes = tree()
        now = current(nodes)
        if now == wanted:
            return nodes
        source = next((n for n in nodes if n.get('focused') == 'true'), None)
        target = node_by_id(nodes, wanted)
        if wanted.startswith('nav-'):
            if now.startswith('nav-'):
                key('RIGHT' if TABS.index(now[4:]) < TABS.index(wanted[4:]) else 'LEFT')
            else:
                key('UP')
            continue
        if now.startswith('nav-'):
            key('DOWN')
            continue
        if source is None or target is None:
            key(scroll_direction)
            continue
        x, y = box(source)
        tx, ty = box(target)
        dx, dy = tx - x, ty - y
        options = ([('DOWN' if dy > 0 else 'UP'), ('RIGHT' if dx > 0 else 'LEFT')]
                   if abs(dy) > abs(dx) else [('RIGHT' if dx > 0 else 'LEFT'), ('DOWN' if dy > 0 else 'UP')])
        attempts = seen.get(now, 0)
        seen[now] = attempts + 1
        key(options[attempts % 2])
    raise AssertionError(f'D-pad could not reach {wanted}; focus={current(tree())}')


def nav(name):
    focus('nav-' + name)
    key('CENTER')
    time.sleep(.5)


def snap(name):
    (OUT / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))
    return tree(name)


def save_results():
    (OUT / 'results.json').write_text(json.dumps(ROWS, indent=2) + '\n')


def check(name, assertion, detail, *evidence):
    assert assertion, detail
    ROWS.append({'journey': name, 'result': 'PASS', 'detail': detail, 'evidence': list(evidence)})
    save_results()
    print('PASS', name, detail, flush=True)


def wait_until(name, predicate, description, seconds=30):
    deadline = time.monotonic() + seconds
    nodes = []
    while time.monotonic() < deadline:
        nodes = tree(name)
        if predicate(nodes):
            return nodes
        time.sleep(.35)
    raise AssertionError(f'{description} did not appear; focus={current(nodes)}')


def wait_for(name, text, seconds=30):
    return wait_until(name, lambda nodes: has(nodes, text), text, seconds)


def wait_id(name, wanted, seconds=30):
    return wait_until(name, lambda nodes: has_id(nodes, wanted), wanted, seconds)


def wait_focus(name, wanted):
    # Observe restoration before any new directional input can hide a failure.
    return wait_until(name, lambda nodes: current(nodes) == wanted, f'focus on {wanted}', 8)


def settings(section):
    nav('About')
    focus('settings-' + section)
    key('CENTER')
    return wait_id('settings-' + section.lower(), 'settings-' + section.lower() + '-content')


def type_query(value):
    focus('key-clear')
    key('CENTER')
    for char in value:
        focus('key-' + char)
        key('CENTER')


def player_parent(name):
    nodes = wait_until(name, lambda ns: all(has_id(ns, rid) for rid in SETTING_ROWS)
                       and current(ns) in SETTING_ROWS, 'Settings sheet with a focused setting row', 8)
    return nodes


def reset_genre(tab):
    focus('genre')
    key('CENTER')
    wait_for(tab.lower() + '-reset-open', 'Choose a genre')
    focus('filter-All', scroll_direction='UP')
    key('CENTER')
    nodes = wait_focus(tab.lower() + '-reset-closed', 'genre')
    trigger = node_by_id(nodes, 'genre')
    assert trigger is not None and 'All genres' in trigger.get('content-desc', ''), f'{tab} did not restore All genres'
    return nodes


def genre_journey(tab, kind, additions):
    prefix = tab.lower()
    nav(tab)
    reset_genre(tab)
    focus('genre')
    key('CENTER')
    nodes = wait_for(prefix + '-genres-open', 'Choose a genre')
    all_before = node_by_id(nodes, 'filter-All')
    assert all_before is not None, f'{tab} genre sheet must initially show All'
    all_bounds = all_before.get('bounds')
    western_before = node_by_id(nodes, 'filter-Western')
    def row_height(node):
        if node is None: return 0
        bounds = list(map(int, re.findall(r'\d+', node.get('bounds', '[0,0][0,0]'))))
        return bounds[3] - bounds[1]
    needs_scroll = row_height(western_before) < row_height(all_before)
    seen = []
    for genre in additions:
        wanted = 'filter-' + genre
        nodes = focus(wanted)
        row = node_by_id(nodes, wanted)
        assert row is not None and current(nodes) == wanted, f'{tab}: missing reachable {genre} row'
        seen.append(genre)
        tree(prefix + '-genre-' + genre.lower().replace(' ', '-'))
    check(tab + ' expanded genre choices', seen == additions,
          'D-pad reached genuine genre rows: ' + ', '.join(seen),
          *[prefix + '-genre-' + genre.lower().replace(' ', '-') + '.xml' for genre in seen])

    # Western is last. Movies need scrolling; the shorter Series list can fit.
    # Compare All's native bounds only when the initial Western row is clipped.
    nodes = focus('filter-Western')
    all_after = node_by_id(nodes, 'filter-All')
    scrolled = all_after is None or all_after.get('bounds') != all_bounds
    western = node_by_id(nodes, 'filter-Western')
    check(tab + ' Western remote reach', (not needs_scroll or scrolled) and western is not None
          and current(nodes) == 'filter-Western' and 'Westerns' in western.get('content-desc', ''),
          ('Scrolled to Westerns' if needs_scroll else 'All choices fit without scrolling; reached Westerns') + ' with D-pad focus', prefix + '-western-sheet.xml')
    snap(prefix + '-western-sheet')
    key('CENTER')
    nodes = wait_focus(prefix + '-western-selected', 'genre')
    trigger = node_by_id(nodes, 'genre')
    check(tab + ' Western selection', trigger is not None and 'Westerns' in trigger.get('content-desc', '')
          and not has_id(nodes, 'browse-filter-sheet'),
          'Selecting Western committed the Westerns filter and restored its trigger', prefix + '-western-selected.xml')
    result_prefix = 'browse-' + kind + '-'
    nodes = wait_until(prefix + '-western-results',
                       lambda ns: any(ident(n).startswith(result_prefix) for n in ns)
                       or has(ns, 'No titles in this category'), 'live Western results or a genuine empty catalog', 35)
    snap(prefix + '-western-results')
    card = next((ident(n) for n in nodes if ident(n).startswith(result_prefix)), None)
    if card:
        check(tab + ' Western real results', True,
              'Live Western discovery returned actual catalog card ' + card, prefix + '-western-results.xml')
        focus(card)
        key('CENTER')
        wait_id(prefix + '-western-detail-ready', 'details-save')
        nodes = wait_until(prefix + '-western-metadata',
                           lambda ns: any(n.get('text', '') == 'Western' or n.get('content-desc', '') == 'Western'
                                          for n in ns), 'Western in actual title metadata', 30)
        check(tab + ' Western metadata', not has_id(nodes, 'genre'),
              'The opened title displays its genuine Western genre metadata; no metadata was manufactured',
              prefix + '-western-metadata.xml')
        snap(prefix + '-western-detail')
        key('BACK')
        wait_focus(prefix + '-western-detail-closed', card)
    else:
        # An empty backend response is recorded truthfully, never as a pass for
        # real Western records. The selection/focus checks still run below.
        ROWS.append({'journey': tab + ' Western real results', 'result': 'SKIP',
                     'detail': 'Live catalog returned No titles in this category; no Western record or metadata claim was made.',
                     'evidence': [prefix + '-western-results.xml', prefix + '-western-results.png']})
        save_results()
        print('SKIP', tab, 'live Western catalog is empty', flush=True)
    focus('genre')
    key('CENTER')
    nodes = wait_for(prefix + '-western-reopened', 'Choose a genre')
    nodes = focus('filter-Western')
    check(tab + ' Western selected state', selected(node_by_id(nodes, 'filter-Western')),
          'The canonical Western choice is checked when reopening the sheet', prefix + '-western-checked.xml')
    tree(prefix + '-western-checked')
    key('BACK')
    nodes = wait_focus(prefix + '-western-back', 'genre')
    check(tab + ' Western Back restoration', not has_id(nodes, 'browse-filter-sheet')
          and 'Westerns' in node_by_id(nodes, 'genre').get('content-desc', ''),
          'Back closed the native genre sheet, preserved Westerns and restored the opener', prefix + '-western-back.xml')
    reset_genre(tab)
    check(tab + ' All genres restored', True,
          'Restored All genres before leaving the section', prefix + '-reset-closed.xml')


def capture_sample_cast():
    try:
        settings('Catalog')
        focus('about-demo')
        key('CENTER')
        wait_for('cast-sample-selected', 'Sample catalog selected.')
        nav('Series')
        wait_id('cast-series-ready', 'browse-tv-66732')
        focus('browse-tv-66732')
        key('CENTER')
        wait_id('cast-details-ready', 'details-play')
        focus('details-season')
        focus('episode-1-1')
        records = json.loads((ROOT / 'src/catalog/demo-records.json').read_text())
        title = next(record for record in records if record['id'] == 66732 and record['kind'] == 'tv')
        credits = [credit.split(' as ', 1) for credit in title['cast'][:3]]
        assert all(len(credit) == 2 for credit in credits), 'Sample cast must contain actual actor and role metadata'
        expected = [value for credit in credits for value in credit]
        nodes = wait_until('cast-columns', lambda ns: all(any(n.get('text', '') == value for n in ns)
                           for value in expected), 'three separate cast actor and role text pairs', 15)
        check('Cast actor and role columns', current(nodes) == 'episode-1-1'
              and not any(n.get('text', '') in title['cast'][:3] for n in nodes),
              'Episode 1 focus reveals three cast columns with individual actor and role Text values from actual sample metadata',
              'cast-columns.xml', 'cast-columns.png')
        snap('cast-columns')
    finally:
        original_error = sys.exc_info()[0] is not None
        try:
            nodes = tree('cast-before-restore')
            if has_id(nodes, 'details-back') or has_id(nodes, 'browse-filter-sheet'):
                key('BACK')
                time.sleep(.4)
            settings('Catalog')
            focus('about-live')
            key('CENTER')
            nodes = wait_for('cast-live-restored', 'Live TMDB catalog selected.')
            assert selected(node_by_id(nodes, 'about-live')), 'Live catalog must be checked after cast capture'
            nav('Home')
            wait_id('genres-final-home', 'home-play')
            focus('home-play')
            check('Live Home restored after cast capture', True,
                  'Restored checked live catalog and Home Play focus for the following playback journey',
                  'cast-live-restored.xml', 'genres-final-home.xml')
        except Exception as restore_error:
            ROWS.append({'journey': 'Cast catalog restoration', 'result': 'FAIL', 'detail': str(restore_error)})
            save_results()
            if not original_error:
                raise
            print(f'Cast catalog restoration failed: {restore_error}', file=sys.stderr, flush=True)


def genres_only_journey():
    visited = []
    try:
        settings('Catalog')
        focus('about-live')
        key('CENTER')
        nodes = wait_for('genres-live-catalog', 'Live TMDB catalog selected.')
        assert selected(node_by_id(nodes, 'about-live'))
        if not GENRES_RESUME:
            check('Expanded genres use live catalog', True,
              'Native Settings confirms that live TMDB discovery is selected', 'genres-live-catalog.xml')
        for tab, kind, additions in [
            ('Movies', 'movie', ['History', 'Music', 'Mystery', 'TV Movie', 'War', 'Western']),
            ('Series', 'tv', ['Kids', 'News', 'Reality', 'Soap', 'Talk', 'War & Politics', 'Western']),
        ]:
            if GENRES_RESUME and tab == 'Movies':
                continue
            visited.append(tab)
            genre_journey(tab, kind, additions)
        capture_sample_cast()
    except Exception:
        # Restore any changed filters even if a metadata or focus assertion
        # fails. Preserve the original failure if cleanup also cannot navigate.
        try:
            nodes = tree('genres-failure-state')
            if has_id(nodes, 'browse-filter-sheet') or has_id(nodes, 'details-back'):
                key('BACK')
                time.sleep(.4)
            for tab in visited:
                nav(tab)
                reset_genre(tab)
        except Exception as cleanup_error:
            ROWS.append({'journey': 'Genre filter restoration', 'result': 'FAIL', 'detail': str(cleanup_error)})
            save_results()
            print(f'Genre filter restoration failed: {cleanup_error}', file=sys.stderr, flush=True)
        raise


def restore_environment():
    commands = [
        ('wifi', ('shell', 'svc', 'wifi', 'enable' if INITIAL_ENVIRONMENT.get('wifi') != '0' else 'disable')),
        ('data', ('shell', 'svc', 'data', 'enable' if INITIAL_ENVIRONMENT.get('data') != '0' else 'disable')),
        ('size', ('shell', 'wm', 'size', INITIAL_ENVIRONMENT.get('size') or 'reset')),
        ('font', ('shell', 'settings', 'delete', 'system', 'font_scale')
         if INITIAL_ENVIRONMENT.get('font') == 'null'
         else ('shell', 'settings', 'put', 'system', 'font_scale', INITIAL_ENVIRONMENT.get('font') or '1.0')),
    ]
    errors = []
    for name, command in commands:
        try:
            adb(*command)
        except Exception as exc:
            errors.append(f'{name}: {exc}')
    if errors:
        (OUT / 'cleanup-errors.json').write_text(json.dumps(errors, indent=2) + '\n')
        print('Environment restoration failed:', '; '.join(errors), file=sys.stderr, flush=True)
    return errors


try:
    INITIAL_ENVIRONMENT['wifi'] = adb('shell', 'settings', 'get', 'global', 'wifi_on').decode().strip()
    INITIAL_ENVIRONMENT['data'] = adb('shell', 'settings', 'get', 'global', 'mobile_data').decode().strip()
    INITIAL_ENVIRONMENT['font'] = adb('shell', 'settings', 'get', 'system', 'font_scale').decode().strip()
    initial_size = adb('shell', 'wm', 'size').decode()
    override = re.search(r'Override size:\s*(\d+x\d+)', initial_size)
    INITIAL_ENVIRONMENT['size'] = override.group(1) if override else ''
    (OUT / 'initial-environment.json').write_text(json.dumps(INITIAL_ENVIRONMENT, indent=2) + '\n')

    if GENRES_ONLY:
        genres_only_journey()
        # SystemExit bypasses the full journey but still executes its existing
        # finally block, restoring native network, display and font settings.
        raise SystemExit(0)

    if not RESUME:
        # Genre is now a native two-column sheet. Select commits and dismisses;
        # Back must dismiss without changing the committed choice.
        nav('Movies')
        focus('genre')
        key('CENTER')
        nodes = wait_for('genre-open', 'Choose a genre')
        check('Genre sheet opens', has_id(nodes, 'browse-filter-sheet') and has_id(nodes, 'filter-All')
              and has_id(nodes, 'filter-Drama') and current(nodes).startswith('filter-'),
              'Native genre sheet owns focus and exposes selectable genre rows', 'genre-open.xml')
        snap('genre-sheet')
        focus('filter-Drama')
        key('CENTER')
        nodes = wait_focus('genre-chosen', 'genre')
        genre_node = node_by_id(nodes, 'genre')
        check('Genre selection commits', not has_id(nodes, 'browse-filter-sheet')
              and genre_node is not None and 'Drama' in genre_node.get('content-desc', ''),
              'Selecting Drama dismissed the sheet and restored its genre trigger', 'genre-chosen.xml')
        focus('genre')
        key('CENTER')
        nodes = wait_for('genre-reopened', 'Choose a genre')
        check('Genre selected state', selected(node_by_id(nodes, 'filter-Drama')),
              'Reopening the genre sheet marks Drama as selected independently of focus', 'genre-reopened.xml')
        focus('filter-All')
        key('BACK')
        nodes = wait_focus('genre-closed', 'genre')
        check('Genre Back scope', not has_id(nodes, 'browse-filter-sheet')
              and 'Drama' in node_by_id(nodes, 'genre').get('content-desc', ''),
              'Back discarded the focused All choice, kept Movies open and restored the Drama trigger', 'genre-closed.xml')
        snap('genre-closed')
        focus('genre')
        key('CENTER')
        wait_id('genre-reset', 'filter-All')
        focus('filter-All')
        key('CENTER')
        wait_focus('genre-reset-closed', 'genre')

        focus('sort')
        key('CENTER')
        nodes = wait_for('sort-open', 'Sort titles')
        check('Sort sheet opens', has_id(nodes, 'filter-original_title.asc')
              and has_id(nodes, 'filter-popularity.desc'),
              'Sort options live in their own native sheet', 'sort-open.xml')
        snap('sort-sheet')
        focus('filter-original_title.asc')
        key('CENTER')
        nodes = wait_focus('sort-chosen', 'sort')
        check('Sort selection commits', 'Title A–Z' in node_by_id(nodes, 'sort').get('content-desc', '')
              and not has_id(nodes, 'browse-filter-sheet'),
              'Title A–Z committed and restored the Sort trigger', 'sort-chosen.xml')
        focus('sort')
        key('CENTER')
        nodes = wait_for('sort-reopened', 'Sort titles')
        check('Sort selected state', selected(node_by_id(nodes, 'filter-original_title.asc')),
              'The committed sort remains visibly selected on reopening', 'sort-reopened.xml')
        key('BACK')
        wait_focus('sort-closed', 'sort')

        nav('Search')
        type_query('DUNE')
        nodes = wait_until('full-word-search', lambda ns: has(ns, 'shown for “DUNE”')
                           and any(ident(n).startswith('search-movie-') for n in ns), 'DUNE movie results')
        check('Full-word remote search', has(nodes, 'Search query: DUNE'),
              'DUNE typed with individual on-screen keys; real movie results returned', 'full-word-search.xml')
        snap('search-dune')
        type_query('ZXQZXQ')
        nodes = wait_for('search-empty', 'No matching titles')
        check('No search results', has(nodes, 'Search query: ZXQZXQ') and has(nodes, 'Try fewer words'),
              'A real unmatched query shows concise editing guidance', 'search-empty.xml')
        snap('search-empty')

        nodes = settings('Catalog')
        check('Settings catalog section', has_id(nodes, 'about-live') and has_id(nodes, 'about-demo'),
              'Catalog section exposes both real catalog choices', 'settings-catalog.xml')
        focus('about-live')
        key('CENTER')
        nodes = wait_for('settings-live', 'Live TMDB catalog selected.')
        check('Live catalog selected', selected(node_by_id(nodes, 'about-live'))
              and not selected(node_by_id(nodes, 'about-demo')),
              'Live choice is checked while the sample choice remains unchecked', 'settings-live.xml')
        snap('settings-catalog-live')
        focus('settings-Remote')
        key('CENTER')
        nodes = wait_id('settings-remote', 'settings-remote-content')
        check('Settings remote section', has(nodes, 'Using your remote') and has(nodes, 'Playback')
              and not has_id(nodes, 'about-live'),
              'Remote guidance has its own section rather than sharing the catalog action surface', 'settings-remote.xml')
        snap('settings-remote')
        focus('settings-About')
        key('CENTER')
        nodes = wait_id('settings-about', 'settings-about-content')
        app_version = json.loads((ROOT / 'package.json').read_text())['version']
        check('Settings attribution section', has(nodes, app_version)
              and has(nodes, 'not endorsed or certified by TMDB') and has(nodes, 'ExoPlayer')
              and has(nodes, 'The Movie Database'),
              'About shows the app version, Android playback capability, TMDB logo label and required attribution', 'settings-about.xml')
        snap('settings-about')
        focus('settings-Catalog')
        key('CENTER')
        wait_id('settings-catalog-sample', 'about-demo')
        focus('about-demo')
        key('CENTER')
        nodes = wait_for('sample-selected', 'Sample catalog selected.')
        check('Sample catalog selected', selected(node_by_id(nodes, 'about-demo'))
              and not selected(node_by_id(nodes, 'about-live')),
              'Sample choice is actually checked after changing catalogs', 'sample-selected.xml')
        snap('settings-catalog-sample')

        nav('Series')
        nodes = wait_id('sample-series', 'browse-tv-66732')
        target = 'browse-tv-66732'  # Stranger Things has bundled season and episode metadata.
        focus(target)
        key('CENTER')
        wait_id('series-details-ready', 'details-play')
        focus('details-season')
        key('CENTER')
        nodes = wait_for('season-open', 'Choose a season')
        season_node = next((n for n in nodes if ident(n).startswith('season-') and selected(n)), None)
        assert season_node is not None, 'Season sheet must mark its current season as selected'
        season = ident(season_node)
        check('Season sheet opens', has_id(nodes, 'season-1') and has_id(nodes, 'season-2'),
              'Genuine sample series exposes its two bundled seasons in a native chooser', 'season-open.xml')
        snap('series-season-sheet')
        focus(season)
        key('CENTER')
        nodes = wait_focus('season-reselected', 'details-season')
        check('Reselect current season', not any(ident(n).startswith('season-') for n in nodes),
              'Reselecting the checked season dismisses the sheet and restores its trigger', 'season-reselected.xml')
        nodes = focus('details-play')
        play = node_by_id(nodes, 'details-play')
        check('Reselected season remains playable', play is not None and play.get('enabled') == 'true',
              'Reselecting the current season leaves Play enabled', 'state.xml')
        focus('details-season')
        key('CENTER')
        wait_for('season-back-open', 'Choose a season')
        key('BACK')
        wait_focus('season-back-closed', 'details-season')
        nodes = tree('series-episodes')
        episode = next((ident(n) for n in nodes if ident(n).startswith('episode-')), None)
        assert episode, 'Bundled season must expose episode cards'
        nodes = focus(episode)
        check('Episode remote focus', current(nodes) == episode,
              f'D-pad reached genuine episode card {episode}', 'episode-focus.xml')
        snap('episode-focus')
        key('BACK')
        nodes = wait_focus('series-detail-closed', target)
        check('Detail focus restoration', current(nodes) == target,
              'Back restored the series card that opened Details', 'series-detail-closed.xml')

    settings('Catalog')
    focus('about-live')
    key('CENTER')
    wait_for('live-restored', 'Live TMDB catalog selected.')
    nav('Home')
    focus('home-details')
    key('CENTER')
    wait_id('movie-details', 'details-save')
    snap('movie-details')
    key('BACK')
    nodes = wait_focus('hero-detail-closed', 'home-details')
    check('Hero focus restoration', current(nodes) == 'home-details',
          'Back restored Details on the Home feature', 'hero-detail-closed.xml')

    # Native network state only. A new query avoids the catalog's cached responses.
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    nav('Search')
    type_query('QXZ')
    nodes = wait_for('offline-search', 'Search couldn’t connect', 40)
    check('Offline catalog recovery', has_id(nodes, 'search-retry') and has_id(nodes, 'search-demo'),
          'A fresh offline query exposes Try again and Use sample catalog', 'offline-search.xml')
    snap('offline-search')
    nav('Home')
    focus('home-play')
    key('CENTER')
    nodes = wait_for('unavailable-stream', 'Playback unavailable', 55)
    check('Unavailable stream', has_id(nodes, 'player-retry') and has_id(nodes, 'player-preview')
          and not has_id(nodes, 'player-position') and not has_id(nodes, 'player-toggle'),
          'Failed native playback shows recovery actions without a transport or simulated clock', 'unavailable-stream.xml')
    snap('unavailable-stream')
    focus('player-preview')
    key('CENTER')
    # Pause before the first dump: a running preview ticks every second, and
    # UIAutomator's idle wait can otherwise outlast the six-second auto-hide.
    key('MEDIA_PLAY_PAUSE')
    key('UP')
    nodes = wait_until('explicit-preview', lambda ns: has(ns, 'Concept')
                       and has_id(ns, 'player-toggle') and has_id(ns, 'player-position'), 'explicit player concept')
    check('Concept player', has(nodes, 'Concept') and not has(nodes, 'Simulated preview') and not has(nodes, 'No video or audio is playing'),
          'Concept opens explicitly with one quiet label and no preview banners', 'explicit-preview.xml')
    snap('player-transport')

    focus('player-settings')
    key('CENTER')
    nodes = player_parent('player-settings-open')
    check('Player settings hierarchy', not has_id(nodes, 'option-fit'),
          f'Native Settings sheet exposes quality, screen fit and speed; focus={current(nodes)}', 'player-settings-open.xml')
    snap('player-settings-sheet')
    focus('player-aspect')
    key('CENTER')
    nodes = wait_for('aspect-menu', 'Screen fit')
    check('Nested aspect menu', all(has_id(nodes, 'option-' + option) for option in ['fill', 'fit', 'stretch']),
          'Screen fit opens its own Fill, Original and Stretch choices', 'aspect-menu.xml')
    snap('player-screen-fit-sheet')
    key('BACK')
    nodes = player_parent('aspect-back-parent')
    check('Aspect Back hierarchy', not has_id(nodes, 'option-fit'),
          f'Back returns to Settings with a valid focused setting row; focus={current(nodes)}', 'aspect-back-parent.xml')
    focus('player-aspect')
    key('CENTER')
    wait_id('aspect-select-open', 'option-fit')
    focus('option-fit')
    key('CENTER')
    nodes = player_parent('aspect-selected-parent')
    check('Aspect selection commits', 'Original' in node_by_id(nodes, 'player-aspect').get('content-desc', ''),
          f'Selecting Original updates its parent setting value; focus={current(nodes)}', 'aspect-selected-parent.xml')

    focus('player-speed')
    key('CENTER')
    nodes = wait_for('speed-menu', 'Playback speed')
    check('Nested speed menu', all(has_id(nodes, 'option-' + speed) for speed in ['0.5', '1', '1.5', '2']),
          'Playback speed exposes 0.5×, 1×, 1.5× and 2× in its nested sheet', 'speed-menu.xml')
    snap('player-speed-sheet')
    focus('option-1.5')
    key('CENTER')
    nodes = player_parent('speed-selected-parent')
    check('Speed selection commits', '1.5×' in node_by_id(nodes, 'player-speed').get('content-desc', ''),
          f'Selecting 1.5× updates its parent setting value; focus={current(nodes)}', 'speed-selected-parent.xml')
    focus('player-speed')
    key('CENTER')
    wait_id('speed-back-open', 'option-1.5')
    key('BACK')
    nodes = player_parent('speed-back-parent')
    check('Speed Back hierarchy', not has_id(nodes, 'option-1.5'),
          f'Back returns to Settings with valid focus; focus={current(nodes)}', 'speed-back-parent.xml')
    key('BACK')
    nodes = wait_focus('settings-closed', 'player-settings')
    check('Player menu focus restoration', not has_id(nodes, 'player-menu'),
          'Closing Settings restores its opening player-settings control', 'settings-closed.xml')
    snap('player-settings-closed')
    focus('player-exit')
    key('CENTER')
    nodes = wait_focus('preview-exited', 'home-play')
    check('Player exit focus restoration', not has_id(nodes, 'player-toggle'),
          'Exit player returns to its original Home Play control', 'preview-exited.xml')

    adb('shell', 'svc', 'wifi', 'enable')
    adb('shell', 'svc', 'data', 'enable')
    adb('shell', 'wm', 'size', '1920x1080')
    time.sleep(.5)
    nav('Home')
    snap('home-1080p')
    settings('Catalog')
    snap('settings-1080p')

    # Native TV canvases, followed by a larger system font; finally restores the
    # values captured at startup even when any assertion or capture fails.
    adb('shell', 'wm', 'size', '1280x720')
    time.sleep(.5)
    nav('Home')
    snap('home-720p')
    nav('Search')
    focus('key-clear')
    key('CENTER')
    snap('search-720p')
    adb('shell', 'wm', 'size', '1920x1080')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
    time.sleep(.5)
    settings('About')
    snap('settings-about-font-130')
    settings('Catalog')
    snap('settings-catalog-font-130')
    nav('Home')
    snap('home-font-130')
    check('TV sizes and font scaling', True,
          'Native captures saved at 1920×1080, 1280×720 and 130% font scaling; visual judgment is separate',
          'home-1080p.png', 'settings-1080p.png', 'home-720p.png', 'search-720p.png',
          'settings-about-font-130.png', 'settings-catalog-font-130.png', 'home-font-130.png')
except Exception as exc:
    ROWS.append({'journey': 'Extended run', 'result': 'FAIL', 'detail': str(exc)})
    save_results()
    try:
        snap('failure')
    except Exception as capture_error:
        print(f'Failure capture unavailable: {capture_error}', file=sys.stderr)
    raise
finally:
    active_error = sys.exc_info()[0] is not None
    cleanup_errors = restore_environment()
    if cleanup_errors:
        ROWS.append({'journey': 'Environment restoration', 'result': 'FAIL', 'detail': '; '.join(cleanup_errors)})
        save_results()
        if not active_error:
            raise RuntimeError('Native environment restoration failed; see cleanup-errors.json')
