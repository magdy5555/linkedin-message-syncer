FROM apify/actor-node:20

COPY . ./

RUN npm install

CMD npm start
# Use the official Apify image that includes Playwright and its dependencies
FROM apify/actor-node-playwright
