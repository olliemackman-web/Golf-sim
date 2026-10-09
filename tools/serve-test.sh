#!/bin/sh
# Restart the non-reloading test server on port 5180.
for p in $(ps aux | grep "[n]ode_modules/.bin/vite --port 5180" | awk '{print $2}'); do kill $p; done
sleep 1
NO_HMR=1 setsid npx vite --port 5180 --strictPort > /tmp/vite-test.log 2>&1 &
sleep 3
