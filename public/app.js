/* ═══════════════════════════════════════════
   State
═══════════════════════════════════════════ */
let schedules = [];
let history   = [];

/* ═══════════════════════════════════════════
   Timezone list (IANA → city, ordered UTC-12→+14)
═══════════════════════════════════════════ */
const TIMEZONES = [
  { value: 'Pacific/Midway',                label: 'Midway Island'     },
  { value: 'Pacific/Honolulu',              label: 'Honolulu'          },
  { value: 'America/Anchorage',             label: 'Anchorage'         },
  { value: 'America/Vancouver',             label: 'Vancouver'         },
  { value: 'America/Los_Angeles',           label: 'Los Angeles'       },
  { value: 'America/Phoenix',               label: 'Phoenix'           },
  { value: 'America/Denver',                label: 'Denver'            },
  { value: 'America/Mexico_City',           label: 'Mexico City'       },
  { value: 'America/Chicago',               label: 'Chicago'           },
  { value: 'America/Bogota',                label: 'Bogotá'            },
  { value: 'America/Lima',                  label: 'Lima'              },
  { value: 'America/New_York',              label: 'New York'          },
  { value: 'America/Caracas',               label: 'Caracas'           },
  { value: 'America/Halifax',               label: 'Halifax'           },
  { value: 'America/St_Johns',              label: "St. John's"        },
  { value: 'America/Sao_Paulo',             label: 'São Paulo'         },
  { value: 'America/Argentina/Buenos_Aires',label: 'Buenos Aires'      },
  { value: 'Atlantic/South_Georgia',        label: 'South Georgia'     },
  { value: 'Atlantic/Azores',               label: 'Azores'            },
  { value: 'Atlantic/Cape_Verde',           label: 'Cape Verde'        },
  { value: 'Africa/Abidjan',               label: 'Abidjan'           },
  { value: 'Europe/London',                 label: 'London'            },
  { value: 'Africa/Lagos',                  label: 'Lagos'             },
  { value: 'Europe/Berlin',                 label: 'Berlin'            },
  { value: 'Europe/Paris',                  label: 'Paris'             },
  { value: 'Europe/Rome',                   label: 'Rome'              },
  { value: 'Europe/Madrid',                 label: 'Madrid'            },
  { value: 'Africa/Cairo',                  label: 'Cairo'             },
  { value: 'Europe/Athens',                 label: 'Athens'            },
  { value: 'Africa/Johannesburg',           label: 'Johannesburg'      },
  { value: 'Europe/Helsinki',               label: 'Helsinki'          },
  { value: 'Europe/Istanbul',               label: 'Istanbul'          },
  { value: 'Africa/Nairobi',                label: 'Nairobi'           },
  { value: 'Asia/Baghdad',                  label: 'Baghdad'           },
  { value: 'Europe/Moscow',                 label: 'Moscow'            },
  { value: 'Asia/Tehran',                   label: 'Tehran'            },
  { value: 'Asia/Dubai',                    label: 'Dubai'             },
  { value: 'Asia/Baku',                     label: 'Baku'              },
  { value: 'Asia/Kabul',                    label: 'Kabul'             },
  { value: 'Asia/Karachi',                  label: 'Karachi'           },
  { value: 'Asia/Tashkent',                 label: 'Tashkent'          },
  { value: 'Asia/Kolkata',                  label: 'Mumbai'            },
  { value: 'Asia/Colombo',                  label: 'Colombo'           },
  { value: 'Asia/Kathmandu',                label: 'Kathmandu'         },
  { value: 'Asia/Dhaka',                    label: 'Dhaka'             },
  { value: 'Asia/Yangon',                   label: 'Yangon'            },
  { value: 'Asia/Bangkok',                  label: 'Bangkok'           },
  { value: 'Asia/Jakarta',                  label: 'Jakarta'           },
  { value: 'Asia/Ho_Chi_Minh',             label: 'Ho Chi Minh City'  },
  { value: 'Asia/Shanghai',                 label: 'Beijing'           },
  { value: 'Asia/Singapore',                label: 'Singapore'         },
  { value: 'Asia/Seoul',                    label: 'Seoul'             },
  { value: 'Asia/Tokyo',                    label: 'Tokyo'             },
  { value: 'Australia/Darwin',              label: 'Darwin'            },
  { value: 'Australia/Adelaide',            label: 'Adelaide'          },
  { value: 'Australia/Brisbane',            label: 'Brisbane'          },
  { value: 'Australia/Sydney',              label: 'Sydney'            },
  { value: 'Asia/Vladivostok',              label: 'Vladivostok'       },
  { value: 'Pacific/Noumea',                label: 'Nouméa'            },
  { value: 'Pacific/Guadalcanal',           label: 'Solomon Islands'   },
  { value: 'Pacific/Auckland',              label: 'Auckland'          },
  { value: 'Pacific/Fiji',                  label: 'Fiji'              },
  { value: 'Pacific/Tongatapu',             label: 'Tonga'             },
  { value: 'Pacific/Kiritimati',            label: 'Line Islands'      },
];

function tzLabel(iana, city) {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: iana, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const offset = parts.find(p => p.type === 'timeZoneName')?.value || 'UTC';
    return `(${offset}) ${city}`;
  } catch { return city; }
}

function populateTimezoneSelect() {
  const sel = document.getElementById('timezone');
  TIMEZONES.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = tzLabel(value, label);
    sel.appendChild(opt);
  });
}

/* ═══════════════════════════════════════════
   Navigation
═══════════════════════════════════════════ */
const pages = { dashboard:'Dashboard', 'activity-log':'Activity Log', settings:'Settings' };
document.querySelectorAll('.sb-item[data-page]').forEach(el => {
  el.addEventListener('click', () => { navTo(el.dataset.page); closeSidebar(); });
});
function navTo(page) {
  if (!pages[page]) page = 'dashboard'; // guard against unknown pages
  // Leaving dashboard — tear down any active HLS previews
  if (page !== 'dashboard' && hlsInstances.size > 0) {
    const list = document.getElementById('relay-list');
    for (const [slot, hls] of hlsInstances) {
      hls.destroy();
      if (list) {
        const wrap = list.querySelector(`[data-preview-wrap="${slot}"]`);
        const btn  = list.querySelector(`[data-preview="${slot}"]`);
        const video = wrap?.querySelector('video');
        if (wrap)  wrap.style.display = 'none';
        if (btn)   btn.classList.remove('sched-btn-active');
        if (video) { video.pause(); video.src = ''; }
      }
    }
    hlsInstances.clear();
  }
  document.querySelectorAll('.sb-item').forEach(e => e.classList.toggle('active', e.dataset.page === page));
  document.querySelectorAll('.page').forEach(e => e.classList.toggle('active', e.id === 'page-'+page));
  document.getElementById('page-title').textContent = pages[page] || page;
  window.history.pushState(null, '', page === 'dashboard' ? '/' : '/' + page);
  if (page === 'dashboard') {
    loadSchedules();
  }
  connectDashboardSSE(); // always connected regardless of current page
  if (page === 'settings') {
    const pg = document.getElementById('page-settings');
    pg.style.visibility = 'hidden';
    loadAutoScheduler().then(() => { pg.style.visibility = 'visible'; });
  }
  if (page === 'activity-log') {
    loadAutoScheduler();
  }
}

// Sidebar drawer (mobile)
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
}
document.getElementById('hamburger-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
});
document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

/* ═══════════════════════════════════════════
   API helpers
═══════════════════════════════════════════ */
const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Unauthorized'); }
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`Server error (${r.status})`);
  return r.json();
};
const GET    = p     => api('GET',    p);
const POST   = (p,b) => api('POST',   p, b);
const PUT    = (p,b) => api('PUT',    p, b);
const DELETE = p     => api('DELETE', p);

/* ═══════════════════════════════════════════
   Toast
═══════════════════════════════════════════ */
function toast(msg, type='ok') {
  const colors = { ok: 'var(--accent)', error: 'var(--danger)', warn: 'var(--warn)' };
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<div class="toast-dot" style="background:${colors[type]||colors.ok}"></div>${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3000);
}

function copyUrlBtn(inputId, btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const val = document.getElementById(inputId)?.value?.trim();
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
      btn.innerHTML = '✓'; btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="9" height="11" rx="1.5"/><path d="M11 4V2.5A1.5 1.5 0 0 0 9.5 1h-7A1.5 1.5 0 0 0 1 2.5v9A1.5 1.5 0 0 0 2.5 13H5"/></svg>'; btn.classList.remove('copied'); }, 1500);
    }).catch(() => toast('Copy failed', 'error'));
  });
}
copyUrlBtn('sm-url', 'sm-url-copy');
copyUrlBtn('am-url', 'am-url-copy');

/* ═══════════════════════════════════════════
   Schedules
═══════════════════════════════════════════ */
async function loadSchedules() {
  schedules = await GET('/api/schedules');
  renderSchedules();
  renderDashboard();
  if (document.getElementById('page-settings').classList.contains('active')) {
    GET('/api/auto-scheduler').then(data => { asData = data; renderAsLog(); });
  }
}

function renderSchedules() {
  const wrap = document.getElementById('sched-list-wrap');
  if (!schedules.length) {
    wrap.innerHTML = '<div class="es-wrap es-sched"><div class="es-badge"><span class="es-dot"></span>No schedules</div><div class="es-sub">Add a one-time or recurring schedule<br>from the channel search</div></div>';
    return;
  }
  wrap.innerHTML = '<div class="item-list" id="sched-list"></div>';
  const list = document.getElementById('sched-list');
  const frag = document.createDocumentFragment();
  [...schedules].reverse().forEach(s => frag.appendChild(makeSchedItem(s)));
  list.appendChild(frag);
}

function makeSchedItem(s) {
  const div = document.createElement('div');
  div.className = 'media-row';
  const { channel: sChannel, title: sTitle } = parseName(s.name);
  div.innerHTML = `
    ${logoImg(s.logo)}
    <div class="item-info">
      <div class="item-name">${esc(sTitle || s.name)}</div>
      <div class="item-meta">
        ${s.scheduleType==='once'&&s.runAt?`<span class="item-tag tag-time">${fmtDt(s.runAt)}</span>`:''}
        ${s.scheduleType==='cron'?`<span class="item-tag tag-time">${esc(describeRecurrence(s))}</span>`:''}
        ${channelTag(sChannel)}
        <span class="item-tag tag-sched-type">${s.scheduleType==='cron'?(s.frequency||'recurring').toUpperCase():'ONCE'}</span>
        ${s.lastRun?`<span class="item-tag tag-time">Last: ${fmtDt(s.lastRun)}</span>`:''}
        ${parseInt(document.getElementById('max-slots')?.value||'2')>1?`<span class="item-tag tag-slot">${esc(s.preferredSlot || 'Auto')}</span>`:''}
      </div>
    </div>
    <div class="sched-actions">
      <button class="sched-btn sched-btn-run"    title="Run now"  data-action="run"    data-id="${s.id}">▶</button>
      <button class="sched-btn sched-btn-edit"   title="Edit"     data-action="edit"   data-id="${s.id}">✎</button>
      <button class="sched-btn sched-btn-delete" title="Delete"   data-action="delete" data-id="${s.id}">✖</button>
    </div>`;
  return div;
}

async function runNow(id) {
  const s = schedules.find(s => s.id === id);
  if (!s) return;
  const max = parseInt(document.getElementById('max-slots')?.value || '2');
  if (max === 1) {
    const r = await POST('/api/play-now', { name: s.name, url: s.url, logo: s.logo || null, preferredSlot: 'stream01', force: true });
    r.ok ? toast('▶ Relaying') : toast(r.error || 'Failed to launch relay', 'error');
    if (r.ok && s.scheduleType === 'once') await DELETE(`/api/schedules/${id}`);
  } else {
    showRelayPicker(s.url, s.name, s.logo || null, async () => {
      if (s.scheduleType === 'once') await DELETE(`/api/schedules/${id}`);
    });
  }
}

async function deleteSchedule(id) {
  await DELETE(`/api/schedules/${id}`);
  toast('Schedule deleted', 'warn');
  loadSchedules();
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sched-btn[data-action]');
  if (btn) {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'run') runNow(id);
    if (action === 'delete') deleteSchedule(id);
    if (action === 'edit') openEditModal(id);
    return;
  }

  const histRow = e.target.closest('.ch-card[data-hist-url]');
  if (histRow) {
    const url = histRow.dataset.histUrl;
    const name = histRow.dataset.histName;
    const logo = histRow.dataset.histLogo || null;
    const max = parseInt(document.getElementById('max-slots')?.value || '2');
    if (max === 1) {
      histRow.style.pointerEvents = 'none';
      const r = await POST('/api/play-now', { url, name, logo, preferredSlot: 'stream01', force: true });
      r.ok ? toast('▶ Relaying') : toast(r.error || 'Failed to launch relay', 'error');
      histRow.style.pointerEvents = '';
    } else {
      showRelayPicker(url, name, logo, null);
    }
  }
});

/* ═══════════════════════════════════════════
   Schedule Modal
═══════════════════════════════════════════ */
let editingId = null;

function setTypeButtonGroupValue(groupId, value) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const inputId = groupId.replace('-group', '');
  const input = document.getElementById(inputId);
  if (input) input.value = value;
  group.querySelectorAll('.btn-group-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function openNewModal() {
  editingId = null;
  document.getElementById('sched-modal-title').textContent = 'New Schedule';
  document.getElementById('sm-name').value      = '';
  document.getElementById('sm-url').value       = '';
  document.getElementById('sm-runat').value     = localDateTimeValue();
  document.getElementById('sm-frequency').value = 'daily';
  document.getElementById('sm-recur-time').value = '20:00';
  populateRecurDaySelect('sm', 'daily');
  populateSlotDropdown('sm-slot');
  setTypeButtonGroupValue('sm-type-group', 'now');
  toggleTypeFields('sm', 'now');
  showModal('sched-modal');
}

function openEditModal(id) {
  const s = schedules.find(x => x.id === id);
  if (!s) return;
  editingId = id;
  document.getElementById('sched-modal-title').textContent = 'Edit Schedule';
  document.getElementById('sm-name').value   = s.name;
  document.getElementById('sm-url').value    = s.url;
  document.getElementById('sm-runat').value  = s.runAt ? s.runAt.slice(0,16) : '';
  if (s.scheduleType === 'cron') {
    document.getElementById('sm-frequency').value  = s.frequency || 'daily';
    document.getElementById('sm-recur-time').value = s.recurTime || '20:00';
    populateRecurDaySelect('sm', s.frequency || 'daily', s.recurDay);
  }
  setTypeButtonGroupValue('sm-type-group', s.scheduleType);
  toggleTypeFields('sm', s.scheduleType);
  populateSlotDropdown('sm-slot', s.preferredSlot);
  showModal('sched-modal');
}

function toggleTypeFields(prefix, v) {
  const onceWrap = document.getElementById(prefix + '-once-wrap');
  const cronWrap = document.getElementById(prefix + '-cron-wrap');
  const runat    = document.getElementById(prefix + '-runat');
  if (v === 'cron') {
    onceWrap.style.display = 'none';
    cronWrap.style.display = '';
  } else {
    onceWrap.style.display = '';
    cronWrap.style.display = 'none';
    runat.disabled = v !== 'once';
  }
}
// Button group handler for schedule type selection
function setupTypeButtonGroup(groupId, prefix) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.btn-group-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      document.getElementById(prefix + '-type').value = value;
      group.querySelectorAll('.btn-group-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toggleTypeFields(prefix, value);
    });
  });
}
setupTypeButtonGroup('sm-type-group', 'sm');
setupTypeButtonGroup('am-type-group', 'am');

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function populateRecurDaySelect(prefix, frequency, selected) {
  const onLabel = document.getElementById(prefix + '-on-label');
  const sel     = document.getElementById(prefix + '-recur-day');
  if (frequency === 'daily') { onLabel.style.display = 'none'; sel.style.display = 'none'; return; }
  onLabel.style.display = '';
  sel.style.display = '';
  sel.innerHTML = '';
  if (frequency === 'weekly') {
    ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].forEach((d, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = d;
      if (i === selected) o.selected = true;
      sel.appendChild(o);
    });
  } else {
    for (let i = 1; i <= 31; i++) {
      const o = document.createElement('option');
      o.value = i; o.textContent = ordinal(i);
      if (i === selected) o.selected = true;
      sel.appendChild(o);
    }
  }
}

function describeRecurrence(s) {
  if (!s.frequency) return s.cronExpr || 'Recurring';
  const [h, m] = (s.recurTime || '00:00').split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if (s.frequency === 'daily')   return timeStr;
  if (s.frequency === 'weekly')  return `${shortDays[s.recurDay] || ''} · ${timeStr}`;
  if (s.frequency === 'monthly') return `${ordinal(s.recurDay || 1)} · ${timeStr}`;
  return s.cronExpr || 'Recurring';
}

document.getElementById('sm-frequency').addEventListener('change', e => populateRecurDaySelect('sm', e.target.value));
document.getElementById('am-frequency').addEventListener('change', e => populateRecurDaySelect('am', e.target.value));

document.getElementById('sched-modal-cancel').addEventListener('click', () => { editingId = null; hideModal('sched-modal'); });
// #5 — shared schedule payload builder
function populateSlotDropdown(id, selectedSlot) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const max = parseInt(document.getElementById('max-slots')?.value || '5');
  sel.innerHTML = '<option value="">Auto</option>';
  for (let i = 0; i < Math.max(1, Math.min(5, max)); i++) {
    const slot = `stream0${i + 1}`;
    const opt  = document.createElement('option');
    opt.value  = slot;
    opt.textContent = slot;
    if (slot === selectedSlot) opt.selected = true;
    sel.appendChild(opt);
  }
}

function updateSlotVisibility() {
  const max  = parseInt(document.getElementById('max-slots')?.value || '2');
  const show = max > 1;

  // Modal slot pickers — hide entirely when only one slot
  ['sm-slot', 'am-slot'].forEach(id => {
    const sel   = document.getElementById(id);
    const field = sel?.closest('.field');
    if (field) field.style.display = show ? '' : 'none';
    if (!show && sel) sel.value = 'stream01';
  });

  // Auto-scheduler Default Relay Slot — always visible; repopulate with correct
  // count (fixes race with loadAutoScheduler), then disable + grey when max = 1
  const asSlot = document.getElementById('as-slot');
  if (asSlot) {
    populateSlotDropdown('as-slot', show ? asSlot.value : 'stream01');
    asSlot.disabled      = !show;
    asSlot.style.opacity = show ? '' : '0.45';
  }
}

function buildSchedulePayload(prefix, url) {
  const scheduleType = document.getElementById(`${prefix}-type`).value;
  const payload = {
    name:          document.getElementById(`${prefix}-name`).value || 'Untitled',
    url,
    scheduleType,
    runAt:         scheduleType === 'once' ? (document.getElementById(`${prefix}-runat`).value || null) : null,
    preferredSlot: document.getElementById(`${prefix}-slot`)?.value || null,
  };
  if (scheduleType === 'cron') {
    payload.frequency = document.getElementById(`${prefix}-frequency`).value;
    payload.recurTime = document.getElementById(`${prefix}-recur-time`).value || '00:00';
    const dayEl = document.getElementById(`${prefix}-recur-day`);
    payload.recurDay = dayEl.style.display !== 'none' ? parseInt(dayEl.value) : null;
  }
  return payload;
}

document.getElementById('sched-modal-save').addEventListener('click', async () => {
  const url  = document.getElementById('sm-url').value.trim();
  if (!url) { toast('Stream URL is required', 'error'); return; }
  const body = buildSchedulePayload('sm', url);
  if (body.scheduleType === 'now') {
    if (editingId) {
      await DELETE(`/api/schedules/${editingId}`);
    }
    hideModal('sched-modal');
    const max = parseInt(document.getElementById('max-slots')?.value || '2');
    if (max === 1) {
      const r = await POST('/api/play-now', { name: body.name, url, preferredSlot: 'stream01', force: true });
      r.ok ? toast('▶ Relaying') : toast(r.error || 'Failed to launch relay', 'error');
    } else {
      showRelayPicker(url, body.name, null, null);
    }
    loadSchedules();
    return;
  }
  if (editingId) {
    await PUT(`/api/schedules/${editingId}`, body);
    toast('Schedule updated');
  } else {
    await POST('/api/schedules', body);
    toast('Schedule created');
  }
  hideModal('sched-modal');
  loadSchedules();
});

/* ═══════════════════════════════════════════
   Dashboard
═══════════════════════════════════════════ */
async function renderDashboard() {
  // Dashboard no longer shows recent activity
}


/* ═══════════════════════════════════════════
   M3U
═══════════════════════════════════════════ */
let m3uReady = false;

function fmtBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

function fmtAge(fetchedAt) {
  const mins = Math.round((Date.now() - fetchedAt) / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs  < 24)  return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

function setSearchEnabled(on) {
  const searchInp = document.getElementById('m3u-search');
  searchInp.disabled = !on;
  if (on) document.getElementById('m3u-search-help').textContent = '';
}

// #2 — merged M3U message display
function showM3UMessage(type, msg) {
  const isErr = type === 'error';
  document.getElementById('m3u-error').style.display   = isErr ? 'block' : '';
  document.getElementById('m3u-success').style.display = isErr ? '' : 'block';
  const el = document.getElementById(isErr ? 'm3u-error' : 'm3u-success');
  el.textContent = (isErr ? '✗ ' : '✓ ') + msg;
}

function resetProgress() {
  document.getElementById('m3u-progress-wrap').style.display = 'none';
  document.getElementById('m3u-progress-bar').style.width    = '0%';
  document.getElementById('m3u-progress-pct').textContent    = '';
  document.getElementById('m3u-progress-bytes').textContent  = '';
  document.getElementById('m3u-progress-label').textContent  = 'Downloading…';
  document.getElementById('m3u-error').style.display         = '';
  document.getElementById('m3u-success').style.display       = '';
}

let m3uCachedSourceUrl = '';
let m3uRefreshEnabled  = false;
let debugLogging = false;

function updateGetBtn() {
  const btn = document.getElementById('m3u-get-btn');
  const inputUrl = document.getElementById('m3u-url').value.trim();
  btn.textContent = (m3uCachedSourceUrl && inputUrl === m3uCachedSourceUrl) ? 'Refresh' : 'Get';
  btn.disabled = !inputUrl;
}

// #3/#6 — unified toggle state helper (uses CSS class instead of inline styles)
function setToggleState(toggleId, enabled) {
  document.getElementById(toggleId).classList.toggle('toggle-on', enabled);
}

function updateM3URefreshToggle() {
  setToggleState('m3u-refresh-toggle', m3uRefreshEnabled);
  document.getElementById('m3u-refresh-time').disabled = !m3uRefreshEnabled;
}

function updateDebugLogToggle() {
  setToggleState('debug-log-toggle', debugLogging);
  ['ffmpeg-log-path', 'ffmpeg-log-max-mb'].forEach(id => {
    const el = document.getElementById(id);
    el.disabled      = !debugLogging;
    el.style.opacity = debugLogging ? '' : '0.4';
  });
}


// Auto-load cache on page open
async function loadCacheInfo() {
  const hint = document.getElementById('m3u-cache-hint');
  try {
    const [cacheRes, settingsRes] = await Promise.all([POST('/api/m3u/use-cache', {}), GET('/api/settings')]);
    if (cacheRes.ok) {
      m3uReady = true;
      m3uCachedSourceUrl = cacheRes.sourceUrl || '';
      hint.textContent = '⊟ Cached file loaded — ' + cacheRes.count.toLocaleString() + ' channels · downloaded ' + fmtAge(cacheRes.fetchedAt) + '.';
      hint.style.color = 'var(--accent)';
      setSearchEnabled(true);
      if (cacheRes.sourceUrl && !document.getElementById('m3u-url').value.trim()) {
        document.getElementById('m3u-url').value = cacheRes.sourceUrl;
      }
      updateGetBtn();
    } else {
      m3uCachedSourceUrl = '';
      hint.textContent = 'No cached file yet — enter a URL and click Get.';
      hint.style.color = '';
      updateGetBtn();
    }
    m3uRefreshEnabled = settingsRes.m3uAutoRefresh || false;
    document.getElementById('m3u-refresh-time').value = settingsRes.m3uRefreshTime || '06:00';
    updateM3URefreshToggle();
    document.getElementById('srs-url').value       = settingsRes.srsUrl      || '';
    document.getElementById('srs-watch-url').value = settingsRes.srsWatchUrl || '';
    document.getElementById('max-slots').value      = String(settingsRes.maxSlots ?? 2);
    updateSlotVisibility();
    debugLogging = !!settingsRes.debugLogging;
    document.getElementById('ffmpeg-log-path').value   = settingsRes.ffmpegLogPath      || '';
    document.getElementById('ffmpeg-log-max-mb').value = settingsRes.ffmpegLogMaxSizeMb ?? 10;
    updateDebugLogToggle();
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fallbackTz = TIMEZONES.some(t => t.value === detectedTz) ? detectedTz : 'America/New_York';
    document.getElementById('timezone').value = settingsRes.timezone || fallbackTz;
    if (!settingsRes.timezone) {
      await PUT('/api/settings', { timezone: document.getElementById('timezone').value });
    }
  } catch(e) {
    hint.textContent = 'No cached file yet — enter a URL and click Get.';
    hint.style.color = '';
  }
}

// Shared download function — called by both Get and Refresh buttons
function startM3UDownload(url) {
  resetProgress();
  const wasReady = m3uReady;
  setSearchEnabled(false);
  m3uReady = false;
  document.getElementById('m3u-results-wrap').style.display = 'none';
  document.getElementById('channel-list').innerHTML = '';

  const getBtn = document.getElementById('m3u-get-btn');
  getBtn.disabled = true;
  getBtn.classList.add('btn-loading');

  const progressWrap = document.getElementById('m3u-progress-wrap');
  const bar          = document.getElementById('m3u-progress-bar');
  const pctEl        = document.getElementById('m3u-progress-pct');
  const bytesEl      = document.getElementById('m3u-progress-bytes');
  const labelEl      = document.getElementById('m3u-progress-label');
  progressWrap.style.display = '';

  const sse = new EventSource('/api/m3u/download?url=' + encodeURIComponent(url));

  sse.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'start') {
      labelEl.textContent = 'Connecting…';
    } else if (msg.type === 'progress') {
      if (msg.pct >= 0) {
        bar.style.width     = msg.pct + '%';
        pctEl.textContent   = msg.pct + '%';
        labelEl.textContent = 'Downloading…';
      } else {
        bar.style.transition = 'none';
        bar.style.width      = '100%';
        bar.style.opacity    = '0.5';
        pctEl.textContent    = '';
        labelEl.textContent  = 'Downloading…';
      }
      bytesEl.textContent = msg.total > 0
        ? fmtBytes(msg.received) + ' / ' + fmtBytes(msg.total)
        : fmtBytes(msg.received) + ' received';
    } else if (msg.type === 'parsing') {
      bar.style.transition = '';
      bar.style.width      = '100%';
      bar.style.opacity    = '1';
      pctEl.textContent    = '100%';
      labelEl.textContent  = 'Parsing channels…';
      bytesEl.textContent  = '';
    } else if (msg.type === 'done') {
      sse.close();
      m3uReady = true;
      progressWrap.style.display = 'none';
      const hint = document.getElementById('m3u-cache-hint');
      hint.textContent = '⊟ Cached file loaded — ' + msg.count.toLocaleString() + ' channels · just downloaded.';
      hint.style.color = 'var(--accent)';
      showM3UMessage('success', msg.count.toLocaleString() + ' channels downloaded and ready to search.');
      setSearchEnabled(true);
      getBtn.disabled = false;
      getBtn.classList.remove('btn-loading');
      m3uCachedSourceUrl = url;
      updateGetBtn();
      toast('✓ ' + msg.count.toLocaleString() + ' channels loaded', 'ok');
    } else if (msg.type === 'error') {
      sse.close();
      progressWrap.style.display = 'none';
      showM3UMessage('error', msg.message);
      getBtn.disabled = false;
      getBtn.classList.remove('btn-loading');
      if (wasReady) { m3uReady = true; setSearchEnabled(true); }
    }
  };

  sse.onerror = () => {
    sse.close();
    progressWrap.style.display = 'none';
    showM3UMessage('error', 'Connection lost. Check that the server is running.');
    getBtn.disabled = false;
    getBtn.classList.remove('btn-loading');
    if (wasReady) { m3uReady = true; setSearchEnabled(true); }
  };
}

// Get / Refresh button
document.getElementById('m3u-get-btn').addEventListener('click', () => {
  const url = document.getElementById('m3u-url').value.trim();
  if (!url) { toast('Enter an M3U/Xtream URL first', 'error'); return; }
  startM3UDownload(url, document.getElementById('m3u-get-btn'));
});

// Update button label as user types in the URL field
document.getElementById('m3u-url').addEventListener('input', updateGetBtn);

document.getElementById('m3u-refresh-toggle').addEventListener('click', async () => {
  m3uRefreshEnabled = !m3uRefreshEnabled;
  updateM3URefreshToggle();
  await PUT('/api/settings', { m3uAutoRefresh: m3uRefreshEnabled, m3uRefreshTime: document.getElementById('m3u-refresh-time').value || '06:00' });
  toast(m3uRefreshEnabled ? 'M3U auto-refresh enabled' : 'M3U auto-refresh disabled');
});

document.getElementById('m3u-refresh-time').addEventListener('input', debounce(async () => {
  await PUT('/api/settings', { m3uAutoRefresh: m3uRefreshEnabled, m3uRefreshTime: document.getElementById('m3u-refresh-time').value || '06:00' });
  toast('Refresh time saved');
}, 2000));

document.getElementById('srs-url').addEventListener('input', debounce(async () => {
  await PUT('/api/settings', { srsUrl: document.getElementById('srs-url').value.trim() });
  toast('SRS URL saved');
}, 1500));
document.getElementById('srs-watch-url').addEventListener('input', debounce(async () => {
  await PUT('/api/settings', { srsWatchUrl: document.getElementById('srs-watch-url').value.trim() });
  toast('Watch URL saved');
}, 1500));
document.getElementById('max-slots').addEventListener('change', async () => {
  await PUT('/api/settings', { maxSlots: parseInt(document.getElementById('max-slots').value) || 2 });
  updateSlotVisibility();
  toast('Max streams saved');
});
document.getElementById('debug-log-toggle').addEventListener('click', async () => {
  debugLogging = !debugLogging;
  updateDebugLogToggle();
  await PUT('/api/settings', { debugLogging });
  toast(debugLogging ? 'Debug logging enabled' : 'Debug logging disabled');
});
document.getElementById('ffmpeg-log-path').addEventListener('input', debounce(async () => {
  await PUT('/api/settings', { ffmpegLogPath: document.getElementById('ffmpeg-log-path').value.trim() });
  toast('Log path saved');
}, 1500));
document.getElementById('ffmpeg-log-max-mb').addEventListener('change', async () => {
  await PUT('/api/settings', { ffmpegLogMaxSizeMb: parseInt(document.getElementById('ffmpeg-log-max-mb').value) || 10 });
  toast('Max log size saved');
});
document.getElementById('timezone').addEventListener('change', async () => {
  await PUT('/api/settings', { timezone: document.getElementById('timezone').value });
  toast('Timezone saved');
});

// Search
// Live search
function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

const doSearch = debounce(async () => {
  const query = document.getElementById('m3u-search').value.trim();
  if (query.length < 2) {
    document.getElementById('m3u-results-wrap').style.display = 'none';
    document.getElementById('m3u-search-help').textContent = '';
    return;
  }
  if (!m3uReady) return;
  try {
    const r = await POST('/api/m3u/search', { query });
    renderChannels(r.channels, r.count, r.total);
  } catch(e) { toast('Search error: ' + e.message, 'error'); }
}, 200);

document.getElementById('m3u-search').addEventListener('input', () => {
  const val = document.getElementById('m3u-search').value;
  document.getElementById('m3u-search-clear').classList.toggle('show', val.length > 0);
  if (val.length < 2) {
    doSearch.cancel();
    document.getElementById('m3u-results-wrap').style.display = 'none';
    document.getElementById('m3u-search-help').textContent = '';
    return;
  }
  doSearch();
});

function clearChannelSearch() {
  document.getElementById('m3u-search').value = '';
  document.getElementById('m3u-search-clear').classList.remove('show');
  document.getElementById('m3u-results-wrap').style.display = 'none';
  document.getElementById('m3u-search-help').textContent = '';
  document.getElementById('channel-list').innerHTML = '';
}

document.getElementById('m3u-search-clear').addEventListener('click', clearChannelSearch);


function renderChannels(channels, count, total) {
  const card = document.getElementById('m3u-results-wrap');
  const list = document.getElementById('channel-list');
  list.scrollTop = 0; // reset scroll to top on new results
  card.style.display = '';
  const helpEl = document.getElementById('m3u-search-help');
  helpEl.textContent = total !== undefined && count !== total
    ? `Showing ${channels.length.toLocaleString()} of ${count.toLocaleString()} matches (${total.toLocaleString()} total)`
    : `${channels.length.toLocaleString()} channels`;
  list.innerHTML = '';
  if (!channels.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">▶</div><p>No channels found.</p></div>';
    return;
  }
  const frag = document.createDocumentFragment();
  channels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'media-row log-item ch-card';
    const { channel: chChannel, title: chTitle } = parseName(ch.name);
    div.innerHTML = `
      ${logoImg(ch.logo)}
      <div class="item-info">
        <div class="item-name">${esc(chTitle || ch.name)}</div>
        ${(chChannel || ch.eventTime) ? `<div class="item-meta">${ch.eventTime ? `<span class="item-tag tag-time">${fmtDt(ch.eventTime)}</span>` : ''}${channelTag(chChannel)}</div>` : ''}
      </div>`;
    div.addEventListener('click', () => openAddModal(ch));
    frag.appendChild(div);
  });
  list.appendChild(frag);
}

function logoError(img) {
  img.style.display = 'none';
  img.nextElementSibling.classList.remove('hidden');
}
function logoImg(logo) {
  if (logo) return `<img class="item-logo" src="/api/proxy-image?url=${encodeURIComponent(logo)}" loading="lazy" decoding="async" onerror="logoError(this)" alt=""/>` +
    `<div class="item-logo-placeholder hidden">📺</div>`;
  return `<div class="item-logo-placeholder">📺</div>`;
}

function parseName(name) {
  if (!name) return { channel: null, title: '' };
  const idx = name.indexOf(' | ');
  if (idx === -1) return { channel: null, title: name.trim() };
  const firstSegment = name.slice(0, idx).trim();
  if (firstSegment.length > 30) return { channel: null, title: name.trim() };
  return { channel: firstSegment, title: name.slice(idx + 3).trim() };
}

function channelTag(channel) {
  if (!channel) return '';
  return `<span class="item-tag tag-channel">${esc(channel)}</span>`;
}

/* ═══════════════════════════════════════════
   Add-to-Schedule Modal
═══════════════════════════════════════════ */
function openAddModal(ch) {
  document.getElementById('am-name').value   = ch.name;
  document.getElementById('am-url').value    = ch.url;
  document.getElementById('am-logo').value   = ch.logo || '';

  // Use eventTime extracted by the server from tvg-name before stripping it from display name
  if (ch.eventTime) {
    const dt = new Date(ch.eventTime);
    dt.setMinutes(dt.getMinutes() + 10);
    setTypeButtonGroupValue('am-type-group', 'once');
    document.getElementById('am-runat').value = localDateTimeValue(dt);
    toggleTypeFields('am', 'once');
  } else {
    setTypeButtonGroupValue('am-type-group', 'now');
    document.getElementById('am-runat').value = localDateTimeValue();
    toggleTypeFields('am', 'now');
  }
  document.getElementById('am-frequency').value  = 'daily';
  document.getElementById('am-recur-time').value = '20:00';
  populateRecurDaySelect('am', 'daily');
  populateSlotDropdown('am-slot');
  showModal('add-modal');
}
document.getElementById('add-modal-cancel').addEventListener('click', () => hideModal('add-modal'));
document.getElementById('add-modal-save').addEventListener('click', async () => {
  const url  = document.getElementById('am-url').value.trim();
  const body = buildSchedulePayload('am', url);
  if (body.scheduleType === 'now') {
    const logo = document.getElementById('am-logo').value || null;
    hideModal('add-modal');
    const max = parseInt(document.getElementById('max-slots')?.value || '2');
    if (max === 1) {
      const r = await POST('/api/play-now', { name: body.name, url, logo, preferredSlot: 'stream01', force: true });
      r.ok ? toast('▶ Relaying') : toast(r.error || 'Failed to launch relay', 'error');
    } else {
      showRelayPicker(url, body.name, logo, null);
    }
    return;
  }
  await POST('/api/schedules', body);
  toast('Added to schedules!');
  hideModal('add-modal');
  loadSchedules();
});

// ── Relay Picker ──────────────────────────────────────────────────────────────
document.getElementById('rp-cancel').addEventListener('click', () => hideModal('relay-picker-modal'));
async function executeRelay(slot) {
  hideModal('relay-picker-modal');
  const { url, name, logo, onSuccess } = rpPendingPayload;
  const occupied = slot && relayData.find(r => r.slot === slot);
  const payload  = { url, name, logo };
  if (slot)     payload.preferredSlot = slot;
  if (occupied) payload.force         = true;
  const r = await POST('/api/play-now', payload);
  r.ok ? toast(`▶ Relaying on ${r.slot}`) : toast(r.error || 'Failed to launch relay', 'error');
  if (r.ok && onSuccess) await onSuccess(r);
}

/* ═══════════════════════════════════════════
   Settings
═══════════════════════════════════════════ */
document.getElementById('save-pw-btn').addEventListener('click', async () => {
  const pw      = document.getElementById('set-pw-new').value;
  const confirm = document.getElementById('set-pw-confirm').value;
  const result  = document.getElementById('pw-result');
  const showPwMsg = (msg, ok) => {
    result.innerHTML = `<span class="pw-result" style="color:${ok?'var(--accent)':'var(--danger)'}">
      ${ok ? '✓' : '✗'} ${msg}</span>`;
  };
  if (!pw)            return showPwMsg('Enter a new password.', false);
  if (pw.length < 6)  return showPwMsg('Password must be at least 6 characters.', false);
  if (pw !== confirm) return showPwMsg('Passwords do not match.', false);
  const btn = document.getElementById('save-pw-btn');
  btn.disabled = true;
  try {
    const r = await POST('/api/auth/change-password', { password: pw });
    if (r.ok) {
      showPwMsg('Password changed successfully.', true);
      document.getElementById('set-pw-new').value     = '';
      document.getElementById('set-pw-confirm').value = '';
    } else {
      showPwMsg(r.error || 'Failed to change password.', false);
    }
  } catch(e) { showPwMsg(e.message, false); }
  btn.disabled  = false;
});

/* ═══════════════════════════════════════════
   Modal helpers
═══════════════════════════════════════════ */
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }
document.querySelectorAll('.modal-overlay:not(#restart-modal)').forEach(o => {
  let downOnOverlay = false;
  o.addEventListener('mousedown', e => { downOnOverlay = e.target === o; });
  o.addEventListener('mouseup',   e => { if (downOnOverlay && e.target === o) o.classList.remove('show'); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal-overlay.show:not(#restart-modal)');
  if (open) open.classList.remove('show');
});

/* ═══════════════════════════════════════════
   Auth
═══════════════════════════════════════════ */

// ── Active Relays ─────────────────────────────────────────────────────────────
let relayData        = [];
let rpPendingPayload = null; // { url, name, logo, onSuccess }
const hlsInstances = new Map();

function showRelayPicker(url, name, logo, onSuccess) {
  rpPendingPayload = { url, name, logo, onSuccess };
  const max     = parseInt(document.getElementById('max-slots')?.value || '2');
  const allFull = relayData.length >= max;
  const list    = document.getElementById('rp-slot-list');
  list.innerHTML = '';

  function makeItem(slot, label, stateText, disabled, playing) {
    const div = document.createElement('div');
    div.className = 'rp-slot-item' + (disabled ? ' rp-slot-item--disabled' : '');
    div.dataset.slot = slot;
    div.innerHTML = `<span class="rp-slot-name">${label}</span>`
                  + `<span class="rp-slot-state${playing ? ' rp-slot-playing' : ''}">${esc(stateText)}</span>`;
    if (!disabled) div.addEventListener('click', () => executeRelay(slot));
    return div;
  }

  // Auto option — disabled when all slots are full
  list.appendChild(makeItem('', 'Auto', allFull ? 'All slots occupied' : 'First available slot', allFull, false));

  // Per-slot options
  for (let i = 0; i < max; i++) {
    const slot   = `stream0${i + 1}`;
    const active = relayData.find(r => r.slot === slot);
    list.appendChild(makeItem(slot, slot, active ? active.name : 'Free', false, !!active));
  }

  showModal('relay-picker-modal');
}

function makeRelayCard(relay) {
  const wrap = document.createElement('div');
  wrap.dataset.slot = relay.slot;
  const { channel, title } = parseName(relay.name);
  const watchUrl = `${(document.getElementById('srs-watch-url')?.value || '').replace(/\/$/, '')}/${relay.slot}.m3u8`;
  wrap.innerHTML = `
    <div class="media-row">
      ${logoImg(relay.logo)}
      <div class="item-info">
        <div class="item-name">${esc(title || relay.name)}</div>
        <div class="item-meta">
          <span class="item-tag tag-time">${fmtDt(relay.startedAt)}</span>
          ${channelTag(channel)}
          ${parseInt(document.getElementById('max-slots')?.value||'2')>1?`<span class="item-tag tag-slot">${esc(relay.slot)}</span>`:''}
        </div>
      </div>
      <div class="np-header-actions">
        <button class="sched-btn" data-preview="${esc(relay.slot)}" title="Show/Hide Preview">▶</button>
        <button class="sched-btn sched-btn-stop" data-stop="${esc(relay.slot)}" title="Stop relay">■</button>
      </div>
    </div>
    <div class="preview-wrap" data-preview-wrap="${esc(relay.slot)}" style="margin-top:12px">
      <div class="pv-wrap" data-preview-placeholder="${esc(relay.slot)}">
        <div class="pv-badge"><span class="pv-dot"></span>No active preview</div>
        <div class="pv-sub">Start a preview by clicking on the preview button</div>
      </div>
      <video controls muted playsinline class="preview-video" style="display:none"></video>
    </div>`;
  wrap.querySelector(`[data-preview="${relay.slot}"]`).addEventListener('click', () => toggleRelayPreview(relay.slot, watchUrl));
  wrap.querySelector(`[data-stop="${relay.slot}"]`).addEventListener('click', () => stopRelay(relay.slot));
  return wrap;
}

async function toggleRelayPreview(slot, watchUrl) {
  const list  = document.getElementById('relay-list');
  const wrap  = list?.querySelector(`[data-preview-wrap="${slot}"]`);
  const btn   = list?.querySelector(`[data-preview="${slot}"]`);
  const video       = wrap?.querySelector('video');
  const placeholder = wrap?.querySelector('[data-preview-placeholder]');
  if (!wrap || !btn || !video) return;

  const isVisible = video.style.display !== 'none';

  const pvBadge = placeholder?.querySelector('.pv-badge');
  const pvSub   = placeholder?.querySelector('.pv-sub');

  function setPlaceholderState(loading) {
    if (pvBadge) pvBadge.innerHTML = loading
      ? '<span class="pv-dot"></span>Preview loading'
      : '<span class="pv-dot"></span>No active preview';
    if (pvSub) pvSub.innerHTML = loading
      ? '<span class="pv-spinner"></span>'
      : 'Start a preview by clicking on the preview button.';
  }

  if (isVisible) {
  video.pause();
  video.removeAttribute('src');
  video.style.display = 'none';
  if (placeholder) { setPlaceholderState(false); placeholder.style.display = ''; }
  btn.textContent = '▶';
  btn.title = 'Show/Hide Preview';
 if (hlsInstances.has(slot)) { hlsInstances.get(slot).destroy(); hlsInstances.delete(slot); }
  } else {
    btn.className = 'sched-btn sched-btn-active';
    setPlaceholderState(true);

    // Poll for stream readiness - SRS returns 404 when no stream exists, 200 when playing
    let attempts = 0;
    const maxAttempts = 12;

    while (attempts < maxAttempts) {
      try {
        const resp = await fetch(watchUrl, { method: 'HEAD', timeout: 500 });
        if (resp.status === 200) break; // Stream is playing
      } catch(e) {}
      attempts++;
      if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 300));
    }

    if (placeholder) placeholder.style.display = 'none';
    video.style.display = 'block';
    btn.className = 'sched-btn';
    btn.textContent = '❚❚';
    btn.title = 'Hide Preview';

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls();
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      // Add onError handler to catch manifest fetch issues
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal && !video.src) {
          // Fallback: try direct src after delay
          setTimeout(() => { video.src = watchUrl; video.play().catch(() => {}); }, 1000);
        }
      });
      hls.loadSource(watchUrl);
      hls.attachMedia(video);
      hlsInstances.set(slot, hls);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari fallback with small delay for HLS buffer
      setTimeout(() => { video.src = watchUrl; video.play().catch(() => {}); }, 100);
    } else {
      toast('HLS not supported in this browser', 'error');
    }
  }
}

function renderRelays(relays) {
  const list = document.getElementById('relay-list');
  if (!list) return;
  // Clean up HLS instances for relays that are no longer active
  const activeSlots = new Set((relays || []).map(r => r.slot));
  for (const [slot, hls] of hlsInstances) {
    if (!activeSlots.has(slot)) { hls.destroy(); hlsInstances.delete(slot); }
  }
  if (!relays || relays.length === 0) {
    list.innerHTML = '<div class="es-wrap es-relay"><div class="es-badge"><span class="es-dot"></span>No active relays</div><div class="es-sub">Start a stream from the channel search<br>or trigger a schedule</div></div>';
    return;
  }
  list.innerHTML = '';
  relays.forEach(r => list.appendChild(makeRelayCard(r)));
}

async function stopRelay(slot) {
  if (hlsInstances.has(slot)) { hlsInstances.get(slot).destroy(); hlsInstances.delete(slot); }
  const r = await POST(`/api/relays/${slot}/stop`, {});
  if (!r.ok) toast(r.error || 'Failed to stop relay', 'error');
}

document.getElementById('restartBtn').addEventListener('click', async () => {
  const spinner     = document.getElementById('restart-spinner');
  const successIcon = document.getElementById('restart-success-icon');
  const modalText   = document.getElementById('restart-text');
  
  showModal('restart-modal');
  spinner.style.display = 'inline-block';
  successIcon.style.display = 'none';
  modalText.textContent = 'Service restarting...';

  let currentBootId = null;
  try {
    const initRes = await fetch('/api/ping?_=' + Date.now(), { cache: 'no-store' });
    if (initRes.ok) {
      const data = await initRes.json();
      currentBootId = data.bootId;
    }
  } catch(e) {}

  try {
    await POST('/api/system/restart');
  } catch(e) {
    toast('Restart failed: ' + e.message, 'error');
    hideModal('restart-modal');
    return;
  }

  const checkPing = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/ping?_=' + Date.now(), { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        if (currentBootId && data.bootId === currentBootId) {
          setTimeout(checkPing, 1000);
        } else {
          spinner.style.display = 'none';
          successIcon.style.display = 'inline-block';
          modalText.textContent = 'Service was restarted successfully!';
          setTimeout(() => location.reload(), 1500);
        }
      } else {
        setTimeout(checkPing, 1000);
      }
    } catch (err) {
      setTimeout(checkPing, 1000);
    }
  };
  
  setTimeout(checkPing, 1000);
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await POST('/api/auth/logout');
  location.href = '/login';
});

/* ═══════════════════════════════════════════
   Helpers
═══════════════════════════════════════════ */
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function localDateTimeValue(d) {
  const dt = d || new Date();
  if (!d) dt.setSeconds(0, 0);
  const pad = n => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate()) +
         'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
}
function fmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}


/* ═══════════════════════════════════════════
   Init
═══════════════════════════════════════════ */
(async () => {
  populateTimezoneSelect();
  await Promise.all([loadSchedules(), loadCacheInfo(), loadAutoScheduler()]);
  try {
    const r = await GET('/api/relays');
    relayData = r || [];
    renderRelays(relayData);
  } catch {}
  // Restore page from URL path, default to dashboard
  const savedPage = location.pathname.replace(/^\//, '') || 'dashboard';
  navTo(savedPage);
  connectDashboardSSE();
  connectAutoSchedSSE();
  // Remove loader only after fonts and data are ready — prevents FOUC
  await document.fonts.ready;
  document.getElementById('app-loader').remove();
})();


// ── Auto-Scheduler ────────────────────────────────────────────────────────────
let asData = {};

function renderAsLog() {
  const log = document.getElementById('as-log');
  const mergedEntries = asData.mergedActivityLog || [];
  const maxSlots = parseInt(document.getElementById('max-slots')?.value || '2');
  if (!mergedEntries || mergedEntries.length === 0) {
    log.innerHTML = '<div class="empty" style="padding:20px"><p>No activity yet.</p></div>';
    return;
  }
  log.innerHTML = '<div class="item-list item-list--grid">' + mergedEntries.map(e => {
    // Relay entry
    if (e.type === 'relay') {
      const { channel: hChannel, title: hTitle } = parseName(e.scheduleName);
      const slotTag = maxSlots > 1 ? `<span class="item-tag tag-slot">${esc(e.slot)}</span>` : '';
      return `<div class="media-row log-item">
        ${logoImg(e.logo)}
        <div class="item-info">
          <div class="item-name">${esc(hTitle || e.scheduleName || 'Unknown')}</div>
          <div class="item-meta">
            <span class="item-tag tag-time">${fmtDt(e.timestamp)}</span>
            ${channelTag(hChannel)}
            ${slotTag}
          </div>
        </div>
      </div>`;
    }
    // Auto-scheduler entry
    const icons = { success: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' };
    const icon = icons[e.asType] || 'ℹ️';
    const typeClass = e.asType || 'info';
    return `<div class="media-row log-item">
      <div class="log-icon log-icon--${typeClass}">${icon}</div>
      <div class="item-info">
        <div class="item-name">${esc(e.message)}</div>
        <div class="item-meta"><span class="item-tag tag-time">${fmtDt(e.timestamp)}</span></div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function updateAsToggle() {
  const on         = asData.enabled || false;
  const refreshRow = document.getElementById('as-refresh-row');
  setToggleState('as-toggle', on);
  ['as-search', 'as-time', 'as-offset', 'as-endpoint', 'as-run-btn'].forEach(id => {
    const el = document.getElementById(id);
    el.disabled      = !on;
    el.style.opacity = on ? '' : '0.4';
  });
  refreshRow.style.opacity       = on ? '' : '0.4';
  refreshRow.style.pointerEvents = on ? '' : 'none';
}

// ── SSE connections ───────────────────────────────────────────────────────────
function makeSSE(url, onMessage) {
  let sse = null;
  function connect() {
    if (sse) return;
    sse = new EventSource(url);
    sse.onmessage = e => {
      if (!e.data || e.data.trim() === '') return; // ignore heartbeat
      onMessage(JSON.parse(e.data));
    };
    let reconnecting = false;
    sse.onerror = () => { sse.close(); sse = null; if (!reconnecting) { reconnecting = true; setTimeout(() => { reconnecting = false; connect(); }, 3000); } };
  }
  return connect;
}

const connectDashboardSSE = makeSSE('/api/events', ({ type, relays }) => {
  if (type === 'history') {
    // Refresh merged activity log if Activity Log page is visible
    if (document.getElementById('page-activity-log').classList.contains('active')) {
      loadAutoScheduler();
    }
  }
  if (type === 'schedule') loadSchedules();
  if (type === 'relays')   { relayData = relays || []; renderRelays(relayData); }
});

let asRunCompleteCallback = null;
const connectAutoSchedSSE = makeSSE('/api/auto-scheduler/events', entry => {
  if (entry.type === 'run-complete') {
    if (asRunCompleteCallback) { asRunCompleteCallback(entry.ok); asRunCompleteCallback = null; }
    return;
  }
  asData.activityLog = asData.activityLog || [];
  asData.activityLog.unshift(entry);
  if (asData.activityLog.length > 100) asData.activityLog.length = 100;

  // Refresh merged activity log if Activity Log page is visible
  if (document.getElementById('page-activity-log').classList.contains('active')) {
    const asEntry = {
      type: 'auto-scheduler',
      timestamp: entry.timestamp,
      message: entry.message,
      asType: entry.type
    };
    asData.mergedActivityLog = asData.mergedActivityLog || [];
    asData.mergedActivityLog.unshift(asEntry);
    renderAsLog();
  }
});

function updateAsRefreshToggle() {
  setToggleState('as-refresh-toggle', asData.refreshBeforeRun || false);
}

async function loadAutoScheduler() {
  asData = await GET('/api/auto-scheduler');
  const historyData = await GET('/api/history');

  // Merge relay history and auto-scheduler activity log
  const relayEntries = (historyData || []).map(h => ({
    type: 'relay',
    timestamp: h.startedAt,
    scheduleName: h.scheduleName,
    logo: h.logo,
    slot: h.player,
    status: h.status
  }));
  const asEntries = (asData.activityLog || []).map(e => ({
    type: 'auto-scheduler',
    timestamp: e.timestamp,
    message: e.message,
    asType: e.type
  }));
  const merged = [...relayEntries, ...asEntries].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  asData.mergedActivityLog = merged;

  document.getElementById('as-search').value   = asData.searchString || '';
  document.getElementById('as-time').value     = asData.checkTime || '';
  document.getElementById('as-offset').value   = asData.startOffset ?? 10;
  document.getElementById('as-endpoint').value = asData.apiEndpoint || '';
  populateSlotDropdown('as-slot', asData.preferredSlot || '');
  updateAsToggle();
  updateAsRefreshToggle();
  renderAsLog();
  connectAutoSchedSSE();
}

document.getElementById('as-toggle').addEventListener('click', async () => {
  asData.enabled = !asData.enabled;
  updateAsToggle();
  if (asData.enabled) {
    await POST('/api/auto-scheduler/enable');
    toast('Auto-Scheduler enabled');
  } else {
    await POST('/api/auto-scheduler/disable');
    toast('Auto-Scheduler disabled');
  }
});

const executeAsSave = async () => {
  await PUT('/api/auto-scheduler', {
    searchString:     document.getElementById('as-search').value.trim(),
    checkTime:        document.getElementById('as-time').value,
    startOffset:      Math.max(0, parseInt(document.getElementById('as-offset').value) || 0),
    apiEndpoint:      document.getElementById('as-endpoint').value.trim(),
    refreshBeforeRun: asData.refreshBeforeRun || false,
    preferredSlot:    document.getElementById('as-slot').value || null,
  });
  toast('Auto-Scheduler saved');
};
const scheduleAsSave = debounce(executeAsSave, 2000);

document.getElementById('as-refresh-toggle').addEventListener('click', () => {
  asData.refreshBeforeRun = !asData.refreshBeforeRun;
  updateAsRefreshToggle();
  executeAsSave();
});

['as-search', 'as-time', 'as-offset', 'as-endpoint'].forEach(id => {
  document.getElementById(id).addEventListener('input', scheduleAsSave);
});
document.getElementById('as-slot').addEventListener('change', executeAsSave);

document.getElementById('as-run-btn').addEventListener('click', async () => {
  const btn = document.getElementById('as-run-btn');
  btn.disabled = true;
  btn.classList.add('btn-loading');
  const stopLoader = () => { btn.disabled = false; btn.classList.remove('btn-loading'); };
  try {
    const r = await POST('/api/auto-scheduler/run');
    if (r.error) { stopLoader(); throw new Error(r.error); }
    toast('Auto-Scheduler started — this may take a moment…');
    asRunCompleteCallback = ok => { stopLoader(); toast(ok ? 'Auto-Scheduler run completed!' : 'Auto-Scheduler run failed', ok ? 'ok' : 'error'); };
  } catch (e) {
    stopLoader();
    toast(e.message || 'Auto-Scheduler run failed', 'error');
  }
});



// Schedules and history are updated via SSE — no polling needed
