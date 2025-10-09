# buttons.py
import threading, time, signal, sys
import RPi.GPIO as GPIO

# Map physical buttons -> app actions
BUTTONS = {
    27: ("color", "Green"),   # GPIO27 = select Color:Green
    # add more here later, e.g. 17: ("season","Summer")
}

_DEBOUNCE_MS = 80

class ButtonWatcher:
    def __init__(self, on_action):
        """
        on_action: callable like on_action(facet, value)
                   e.g., on_action("color", "Green")
        """
        self.on_action = on_action
        self._running = False

    def start(self):
        GPIO.setmode(GPIO.BCM)
        for pin in BUTTONS:
            GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
            GPIO.add_event_detect(
                pin, GPIO.FALLING,
                callback=self._make_cb(pin),
                bouncetime=_DEBOUNCE_MS
            )
        self._running = True

        # clean exit for systemd / ctrl+c
        def _graceful_exit(signum, frame):
            self.stop()
            sys.exit(0)
        for s in (signal.SIGINT, signal.SIGTERM):
            signal.signal(s, _graceful_exit)

    def _make_cb(self, pin):
        def _cb(_):
            # Confirm it stayed low after debounce window
            time.sleep(_DEBOUNCE_MS / 1000.0)
            if GPIO.input(pin) == GPIO.LOW:
                facet, value = BUTTONS[pin]
                self.on_action(facet, value)
        return _cb

    def stop(self):
        if self._running:
            GPIO.cleanup()
            self._running = False
