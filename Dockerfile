FROM apify/actor-node:20

COPY . ./

RUN npm install

CMD npm start
