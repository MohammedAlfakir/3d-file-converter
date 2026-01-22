#!/bin/bash



npm install


scripts/docker-build.sh

scripts/docker-start.sh &


npm run server >> /dev/null &


cd client && npm install && cd ..


npm run client >> /dev/null &


echo "DONE" 