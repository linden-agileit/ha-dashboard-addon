FROM node:22-alpine

# jq lets the entrypoint read the add-on options
RUN apk add --no-cache jq

WORKDIR /app

# Runtime dependencies only (express / cors / dotenv)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# The pre-built dashboard + the HA proxy API
COPY api ./api
COPY dist ./dist
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
