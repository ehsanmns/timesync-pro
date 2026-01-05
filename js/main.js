// js/main.js

let editingId = null;

// ======================
// Utilities
// ======================

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function encodeData(members, duration) {
  return btoa(encodeURIComponent(JSON.stringify({ members, duration })));
}

function decodeData(str) {
  try {
    return JSON.parse(decodeURIComponent(atob(str)));
  } catch (e) {
    return null;
  }
}

function getWeekdaysFromCheckboxes() {
  const checkboxes = document.querySelectorAll('.weekdays input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
}

// ======================
// Timezone & DST
// ======================

function getTimezoneOffset(timezone, date) {
  const utc = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  const tzString = utc.toLocaleString('en-CA', { timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [datePart, timePart] = tzString.split(', ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (local - utc) / (1000 * 60);
}

function hasDST(timezone) {
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const janOffset = getTimezoneOffset(timezone, jan);
  const julOffset = getTimezoneOffset(timezone, jul);
  return janOffset !== julOffset;
}

// ======================
// Core Logic Helper
// ======================

function isSlotWithinWorkHours(startHour, durationMinutes, workStartStr, workEndStr) {
  const [wsH, wsM] = workStartStr.split(':').map(Number);
  const [weH, weM] = workEndStr.split(':').map(Number);
  const workStartMinutes = wsH * 60 + wsM;
  const workEndMinutes = weH * 60 + weM;

  const slotStart = startHour * 60;
  const slotEnd = slotStart + durationMinutes;

  return slotStart >= workStartMinutes && slotEnd <= workEndMinutes;
}

// ======================
// UI Rendering
// ======================

function addMemberToUI(member) {
  const list = document.getElementById('members-list');
  const li = document.createElement('li');
  li.dataset.id = member.id;

  const dstWarn = hasDST(member.tz) ? ' ⚠️ DST' : '';
  const daysText = member.weekdays.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');

  li.innerHTML = `
    <div>
      <strong>${member.name}</strong> (${member.tz})${dstWarn}<br>
      <small>Days: ${daysText} | Hours: ${member.start}–${member.end}</small>
    </div>
    <div>
      <button class="btn-edit" data-id="${member.id}">Edit</button>
      <button class="btn-delete" data-id="${member.id}" style="background:#e53e3e;margin-left:0.5rem;color:white;border:none;padding:0.3rem 0.6rem;border-radius:4px;cursor:pointer;">Delete</button>
    </div>
  `;
  list.appendChild(li);

  li.querySelector('.btn-edit').addEventListener('click', () => editMember(member.id));
  li.querySelector('.btn-delete').addEventListener('click', () => deleteMember(member.id));
}

function renderMembersList(members) {
  const list = document.getElementById('members-list');
  list.innerHTML = '';
  members.forEach(m => addMemberToUI(m));
}

function renderMembersListFromStorage() {
  const saved = localStorage.getItem('timesync_members');
  const members = saved ? JSON.parse(saved) : [];
  renderMembersList(members);
}

function renderHeatmapPlaceholder() {
  const container = document.getElementById('heatmap-container');
  container.innerHTML = '';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  container.appendChild(createDayHeader('Hour'));
  days.forEach(day => container.appendChild(createDayHeader(day)));
  
  for (let hour = 0; hour < 24; hour++) {
    container.appendChild(createHourLabel(hour));
    for (let day = 0; day < 7; day++) {
      const cell = document.createElement('div');
      cell.className = 'hour-cell count-0';
      cell.dataset.hour = hour;
      cell.dataset.day = day;
      container.appendChild(cell);
    }
  }
}

function createDayHeader(text) {
  const el = document.createElement('div');
  el.className = 'day-header';
  el.textContent = text;
  return el;
}

function createHourLabel(hour) {
  const el = document.createElement('div');
  el.className = 'day-header';
  el.textContent = hour.toString().padStart(2, '0');
  return el;
}

function renderHeatmap(heatmap, members) {
  const container = document.getElementById('heatmap-container');
  const cells = container.querySelectorAll('.hour-cell');
  cells.forEach(cell => {
    const hour = parseInt(cell.dataset.hour, 10);
    const day = parseInt(cell.dataset.day, 10);
    const count = heatmap[day]?.[hour] || 0;
    const clamped = Math.min(count, 5);
    cell.className = `hour-cell count-${clamped}`;

    cell.addEventListener('mouseenter', () => {
      const tooltip = document.getElementById('tooltip');
      if (count === 0) {
        tooltip.classList.add('hidden');
        return;
      }
      let html = `<strong>Members available:</strong><br>`;
      members.forEach(m => {
        if (m.weekdays.includes(day)) {
          const [startH, startM] = m.start.split(':').map(Number);
          const [endH, endM] = m.end.split(':').map(Number);
          const slotStart = hour * 60;
          const slotEnd = slotStart + 60;
          const workStart = startH * 60 + startM;
          const workEnd = endH * 60 + endM;
          if (slotStart >= workStart && slotEnd <= workEnd) {
            const testDate = new Date(Date.UTC(2025, 0, 6 + day, hour, 0));
            const localTime = testDate.toLocaleString('en-GB', { timeZone: m.tz, hour: '2-digit', hour12: false, minute: '2-digit' });
            html += `${m.name}: ${localTime}<br>`;
          }
        }
      });
      tooltip.innerHTML = html;
      tooltip.classList.remove('hidden');
    });

    cell.addEventListener('mouseleave', () => {
      document.getElementById('tooltip').classList.add('hidden');
    });
  });
}

// ======================
// Edit / Delete Logic
// ======================

function editMember(id) {
  const saved = localStorage.getItem('timesync_members');
  const members = saved ? JSON.parse(saved) : [];
  const member = members.find(m => m.id === id);
  if (!member) return;

  editingId = id;

  document.getElementById('member-name').value = member.name;
  document.getElementById('timezone').value = member.tz;

  document.querySelectorAll('.weekdays input[type="checkbox"]').forEach(cb => {
    cb.checked = member.weekdays.includes(parseInt(cb.value, 10));
  });

  document.getElementById('work-start').value = member.start;
  document.getElementById('work-end').value = member.end;

  deleteMember(id, false);

  document.getElementById('save-edit-btn').classList.add('shown');

  document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
}

function deleteMember(id, reRender = true) {
  let members = JSON.parse(localStorage.getItem('timesync_members') || '[]');
  members = members.filter(m => m.id !== id);
  localStorage.setItem('timesync_members', JSON.stringify(members));

  if (reRender) {
    renderMembersListFromStorage();
  }
}

// ======================
// DOM Setup
// ======================

document.addEventListener('DOMContentLoaded', () => {
  const timezoneSelect = document.getElementById('timezone');
  const timezones = Intl.supportedValuesOf('timeZone').sort();
  timezones.forEach(tz => {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz.replace(/_/g, ' ');
    timezoneSelect.appendChild(opt);
  });

  try {
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timezoneSelect.value = userTz;
  } catch (e) {
    console.warn('Could not detect user timezone');
  }

  // Load data
  let initialData = null;
  const urlParams = new URLSearchParams(window.location.search);
  const urlData = urlParams.get('data');
  if (urlData) {
    initialData = decodeData(urlData);
  } else {
    const saved = localStorage.getItem('timesync_members');
    if (saved) {
      try {
        initialData = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved data');
      }
    }
  }

  let members = [];
  if (initialData?.members) {
    members = initialData.members.map(m => ({
      ...m,
      weekdays: (Array.isArray(m.weekdays) ? m.weekdays : []).map(d => {
        const num = parseInt(d, 10);
        return isNaN(num) ? 1 : num;
      })
    }));
  }
  const duration = initialData?.duration ? parseInt(initialData.duration, 10) : 60;
  document.getElementById('meeting-duration').value = duration;

  renderMembersList(members);

  // Form submit (for new members)
  document.getElementById('member-form').addEventListener('submit', e => {
    e.preventDefault();
    if (editingId) return; // Block form submit during edit

    const name = document.getElementById('member-name').value.trim();
    const tz = document.getElementById('timezone').value;
    const weekdays = getWeekdaysFromCheckboxes();
    const start = document.getElementById('work-start').value;
    const end = document.getElementById('work-end').value;

    if (!name || !tz) return;

    let members = JSON.parse(localStorage.getItem('timesync_members') || '[]');
    const member = { id: generateId(), name, tz, weekdays, start, end };
    members.push(member);

    localStorage.setItem('timesync_members', JSON.stringify(members));
    renderMembersListFromStorage();

    // Reset form
    document.getElementById('member-form').reset();
    document.querySelectorAll('.weekdays input[type="checkbox"]').forEach(cb => cb.checked = [1,2,3,4,5].includes(parseInt(cb.value)));
    document.getElementById('work-start').value = '09:00';
    document.getElementById('work-end').value = '17:00';
    document.getElementById('save-edit-btn').classList.remove('shown');
  });

  // Save edit button
  document.getElementById('save-edit-btn').addEventListener('click', () => {
    const name = document.getElementById('member-name').value.trim();
    const tz = document.getElementById('timezone').value;
    const weekdays = getWeekdaysFromCheckboxes();
    const start = document.getElementById('work-start').value;
    const end = document.getElementById('work-end').value;

    if (!name || !tz) return;

    let members = JSON.parse(localStorage.getItem('timesync_members') || '[]');
    const index = members.findIndex(m => m.id === editingId);
    if (index !== -1) {
      members[index] = { id: editingId, name, tz, weekdays, start, end };
      localStorage.setItem('timesync_members', JSON.stringify(members));
      renderMembersListFromStorage();
    }

    editingId = null;
    document.getElementById('member-form').reset();
    document.querySelectorAll('.weekdays input[type="checkbox"]').forEach(cb => cb.checked = [1,2,3,4,5].includes(parseInt(cb.value)));
    document.getElementById('work-start').value = '09:00';
    document.getElementById('work-end').value = '17:00';
    document.getElementById('save-edit-btn').classList.remove('shown');
  });

  // Find slots
  document.getElementById('find-slots').addEventListener('click', () => {
    const saved = localStorage.getItem('timesync_members');
    const members = saved ? JSON.parse(saved) : [];
    const dur = parseInt(document.getElementById('meeting-duration').value, 10);
    findAndRenderCommonSlots(members, dur);
  });

  // Copy link
  document.getElementById('copy-link').addEventListener('click', async () => {
    const saved = localStorage.getItem('timesync_members');
    const members = saved ? JSON.parse(saved) : [];
    const dur = parseInt(document.getElementById('meeting-duration').value, 10);
    const data = encodeData(members, dur);
    const url = `${window.location.origin}${window.location.pathname}?data=${data}`;
    document.getElementById('share-link').value = url;
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById('copy-link');
      btn.textContent = 'Copied!';
      btn.classList.add('success');
      setTimeout(() => {
        btn.textContent = 'Copy Link';
        btn.classList.remove('success');
      }, 2000);
    } catch (err) {
      alert('Failed to copy link');
    }
  });

  // Tooltip
  const tooltip = document.getElementById('tooltip');
  document.addEventListener('mousemove', e => {
    tooltip.style.left = (e.pageX + 10) + 'px';
    tooltip.style.top = (e.pageY + 10) + 'px';
  });

  renderHeatmapPlaceholder();
});

// ======================
// Core Logic
// ======================

async function findAndRenderCommonSlots(members, durationMinutes) {
  if (members.length === 0) return;

  const normalizedMembers = members.map(m => {
    const weekdays = (Array.isArray(m.weekdays) ? m.weekdays : []).map(d => {
      const num = parseInt(d, 10);
      return isNaN(num) ? 1 : num;
    });
    return { ...m, weekdays };
  });

  const heatmap = Array(7).fill(null).map(() => Array(24).fill(0));
  const totalSteps = 7 * 24;
  let stepsDone = 0;

  const progressBar = document.createElement('div');
  progressBar.textContent = 'Analyzing availability...';
  progressBar.style.cssText = 'text-align:center; padding:0.5rem; background:#e2e8f0; border-radius:6px; margin:1rem 0;';
  document.querySelector('.heatmap-section').insertAdjacentElement('beforebegin', progressBar);

  function processStep() {
    const dayOfWeek = Math.floor(stepsDone / 24);
    const hour = stepsDone % 24;

    let allAvailable = true;
    for (const member of normalizedMembers) {
      const inDay = member.weekdays.includes(dayOfWeek);
      const inTime = isSlotWithinWorkHours(hour, durationMinutes, member.start, member.end);
      if (!inDay || !inTime) {
        allAvailable = false;
        break;
      }
    }

    if (allAvailable) {
      heatmap[dayOfWeek][hour] = normalizedMembers.length;
    }

    stepsDone++;
    progressBar.textContent = `Analyzing... ${Math.round((stepsDone / totalSteps) * 100)}%`;

    if (stepsDone < totalSteps) {
      setTimeout(processStep, 30);
    } else {
      progressBar.remove();
      renderHeatmap(heatmap, normalizedMembers);
    }
  }

  processStep();
}