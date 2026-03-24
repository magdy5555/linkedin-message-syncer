# Step 1: Use the official Apify image that includes Node.js and Playwright
FROM apify/actor-node-playwright

# Step 2: Set the user to root to install dependencies without permission issues
USER root

# Step 3: Copy your package.json file first to leverage Docker cache
COPY package*.json ./

# Step 4: Install Node.js dependencies
RUN npm install

# Step 5: Copy the rest of your source code (like main.js)
COPY . .

# Step 6: IMPORTANT: Switch back to the non-root user for security.
# The Apify base images use a user named 'myuser'.
USER myuser

# Step 7: Set the command to run your actor when the container starts
CMD [ "npm", "start" ]
