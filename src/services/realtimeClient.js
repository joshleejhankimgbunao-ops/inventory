import { apiRequest, getAuthToken } from './apiClient';

const REALTIME_RECONNECT_DELAY_MS = 3000;
const REALTIME_RESYNC_EVENT = 'realtime.resync';

let eventSource = null;
let reconnectTimer = null;
let shouldStayConnected = false;
let ticketRequestController = null;
let connectedDispatcher = null;
let hasConnectedOnce = false;

const subscribers = new Map();
const dispatchers = new Map();

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const cancelTicketRequest = () => {
  if (!ticketRequestController) {
    return;
  }

  ticketRequestController.abort();
  ticketRequestController = null;
};

const closeEventSource = () => {
  if (!eventSource) {
    return;
  }

  if (connectedDispatcher) {
    eventSource.removeEventListener('connected', connectedDispatcher);
    connectedDispatcher = null;
  }

  dispatchers.forEach((dispatcher, eventName) => {
    eventSource.removeEventListener(eventName, dispatcher);
  });
  dispatchers.clear();

  eventSource.close();
  eventSource = null;
};

const dispatchEventToSubscribers = (eventName, event) => {
  const listeners = subscribers.get(eventName);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Never break delivery to other listeners.
    }
  });
};

const bindEventDispatcher = (eventName) => {
  if (!eventSource || dispatchers.has(eventName) || eventName === REALTIME_RESYNC_EVENT) {
    return;
  }

  const dispatcher = (event) => {
    dispatchEventToSubscribers(eventName, event);
  };

  dispatchers.set(eventName, dispatcher);
  eventSource.addEventListener(eventName, dispatcher);
};

const bindAllDispatchers = () => {
  subscribers.forEach((listeners, eventName) => {
    if (listeners.size > 0) {
      bindEventDispatcher(eventName);
    }
  });
};

const scheduleReconnect = () => {
  if (!shouldStayConnected || reconnectTimer) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    ensureRealtimeConnection();
  }, REALTIME_RECONNECT_DELAY_MS);
};

const ensureRealtimeConnection = async () => {
  if (!shouldStayConnected || eventSource || ticketRequestController) {
    return;
  }

  if (!getAuthToken()) {
    // A missing/expired application session must not retry forever.
    shouldStayConnected = false;
    return;
  }

  const controller = new AbortController();
  ticketRequestController = controller;

  try {
    const response = await apiRequest('/api/realtime/ticket', {
      method: 'POST',
      signal: controller.signal,
    });

    if (!shouldStayConnected || ticketRequestController !== controller) {
      return;
    }

    const streamToken = String(response?.streamToken || '').trim();
    if (!streamToken) {
      throw new Error('Realtime stream credential was not issued.');
    }

    const baseUrl = import.meta.env.VITE_API_URL || '';
    const streamUrl = `${baseUrl}/api/realtime/stream?streamToken=${encodeURIComponent(streamToken)}`;
    const source = new EventSource(streamUrl);

    eventSource = source;
    connectedDispatcher = (event) => {
      const shouldResynchronize = hasConnectedOnce;
      hasConnectedOnce = true;
      if (shouldResynchronize) {
        dispatchEventToSubscribers(REALTIME_RESYNC_EVENT, event);
      }
    };
    source.addEventListener('connected', connectedDispatcher);
    bindAllDispatchers();

    source.onerror = () => {
      if (eventSource !== source) {
        return;
      }

      closeEventSource();
      scheduleReconnect();
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }

    // apiRequest clears the primary session and emits the normal expiry event on 401.
    if (!getAuthToken() || error?.status === 401 || error?.status === 403) {
      shouldStayConnected = false;
      return;
    }

    scheduleReconnect();
  } finally {
    if (ticketRequestController === controller) {
      ticketRequestController = null;
    }
  }
};

const startRealtime = () => {
  shouldStayConnected = true;
  clearReconnectTimer();
  ensureRealtimeConnection();
};

const stopRealtimeIfIdle = () => {
  const hasSubscribers = Array.from(subscribers.values()).some((set) => set.size > 0);
  if (hasSubscribers) {
    return;
  }

  shouldStayConnected = false;
  hasConnectedOnce = false;
  clearReconnectTimer();
  cancelTicketRequest();
  closeEventSource();
};

export const subscribeRealtimeEvent = (eventName, handler) => {
  if (!eventName || typeof handler !== 'function') {
    return () => {};
  }

  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, new Set());
  }

  subscribers.get(eventName).add(handler);
  startRealtime();
  bindEventDispatcher(eventName);

  return () => {
    const listeners = subscribers.get(eventName);
    if (!listeners) {
      stopRealtimeIfIdle();
      return;
    }

    listeners.delete(handler);

    if (listeners.size === 0) {
      subscribers.delete(eventName);

      const dispatcher = dispatchers.get(eventName);
      if (dispatcher && eventSource) {
        eventSource.removeEventListener(eventName, dispatcher);
      }
      dispatchers.delete(eventName);
    }

    stopRealtimeIfIdle();
  };
};

export const resetRealtimeConnection = () => {
  clearReconnectTimer();
  cancelTicketRequest();
  closeEventSource();
  if (shouldStayConnected) {
    ensureRealtimeConnection();
  }
};

export const resumeRealtime = () => {
  const hasSubscribers = Array.from(subscribers.values()).some((set) => set.size > 0);
  if (!hasSubscribers) {
    return;
  }

  shouldStayConnected = true;
  clearReconnectTimer();
  ensureRealtimeConnection();
};

export const stopRealtime = () => {
  shouldStayConnected = false;
  hasConnectedOnce = false;
  clearReconnectTimer();
  cancelTicketRequest();
  closeEventSource();
};
