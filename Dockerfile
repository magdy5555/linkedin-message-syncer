# Step 1: Use the official Apify image that includes Node.js and Playwright
FROM apify/actor-node-playwright

# Step 2: Copy your package.json file first to leverage Docker cache
COPY package*.json ./

# Step 3: Install Node.js dependencies
RUN npm install

# Step 4: Copy the rest of your source code (like main.js)
COPY . .

# Step 5: Set the command to run your actor when the container starts
CMD [ "npm", "start" ]
