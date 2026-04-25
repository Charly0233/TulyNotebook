// Tuly Service Worker v1
// Maneja alarmas recurrentes aunque la app esté cerrada

var CACHE_NAME = 'tuly-v1';
var STATIC = ['/', '/index.html', '/manifest.json'];

// ---- INSTALL & CACHE ----
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(clients.claim());
});

// ---- OFFLINE FETCH ----
self.addEventListener('fetch', function(e) {
  // Don't intercept API calls
  if (e.request.url.indexOf('api.anthropic.com') > -1) return;
  if (e.request.url.indexOf('netlify/functions') > -1) return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).catch(function() { return caches.match('/index.html'); });
    })
  );
});

// ---- ALARM STATE ----
var alarms = [];         // [{id, hour, minute, label, body, icon, ci, enabled}]
var alarmTimers = {};    // {id: timeoutId}

// ---- MESSAGES FROM APP ----
self.addEventListener('message', function(e) {
  var msg = e.data;
  if (!msg) return;

  if (msg.type === 'SET_ALARMS') {
    alarms = msg.alarms || [];
    rescheduleAll();
  }

  if (msg.type === 'CANCEL_ALARM') {
    cancelTimer(msg.id);
  }

  if (msg.type === 'CANCEL_ALL') {
    Object.keys(alarmTimers).forEach(function(id) { cancelTimer(id); });
  }

  if (msg.type === 'CI_DONE') {
    // A check-in was completed — cancel matching alarm for today
    var ci = msg.ci;
    alarms.forEach(function(a) {
      if (a.ci === ci) cancelTimer(a.id);
    });
    // Reschedule for tomorrow
    rescheduleAll();
  }
});

function cancelTimer(id) {
  if (alarmTimers[id]) {
    clearTimeout(alarmTimers[id]);
    delete alarmTimers[id];
  }
}

function rescheduleAll() {
  // Clear all pending timers
  Object.keys(alarmTimers).forEach(function(id) { cancelTimer(id); });

  alarms.forEach(function(alarm) {
    if (!alarm.enabled) return;
    scheduleAlarm(alarm);
  });
}

function scheduleAlarm(alarm) {
  var now = new Date();
  var fire = new Date();

  if(alarm.weekday >= 0) {
    // Schedule for the next occurrence of this weekday
    var targetDay = alarm.weekday;
    var currentDay = now.getDay();
    var daysUntil = (targetDay - currentDay + 7) % 7;
    fire.setDate(now.getDate() + daysUntil);
    fire.setHours(alarm.hour, alarm.minute, 0, 0);
    // If it's today but time already passed, schedule for next week
    if(fire.getTime() <= now.getTime()) {
      fire.setDate(fire.getDate() + 7);
    }
  } else {
    // Daily alarm (weekday = -1)
    fire.setHours(alarm.hour, alarm.minute, 0, 0);
    if(fire.getTime() <= now.getTime()) {
      fire.setDate(fire.getDate() + 1);
    }
  }

  var delay = fire.getTime() - now.getTime();

  alarmTimers[alarm.id] = setTimeout(function() {
    delete alarmTimers[alarm.id];
    triggerAlarm(alarm);
    // Reschedule for next week (or next day for daily)
    if(alarm.weekday >= 0) {
      var next = {id:alarm.id,weekday:alarm.weekday,hour:alarm.hour,minute:alarm.minute,enabled:alarm.enabled,label:alarm.label,body:alarm.body,ci:alarm.ci};
      scheduleAlarm(next);
    } else {
      scheduleAlarm(alarm);
    }
  }, delay);
}

function triggerAlarm(alarm) {
  return self.registration.showNotification(alarm.label, {
    body: alarm.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'tuly-' + alarm.ci,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { ci: alarm.ci, url: '/?ci=' + alarm.ci }
  });
}

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var targetUrl = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cs) {
      // Focus existing window if open
      for (var i = 0; i < cs.length; i++) {
        if (cs[i].url.indexOf(self.location.origin) > -1) {
          cs[i].focus();
          cs[i].postMessage({ type: 'OPEN_CI', ci: e.notification.data.ci });
          return;
        }
      }
      // Open new window
      return clients.openWindow(targetUrl);
    })
  );
});
