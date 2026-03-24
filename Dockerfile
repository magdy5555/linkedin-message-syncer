# في ملف Dockerfile، استخدم هذه الصورة بدلاً من الحالية
FROM mcr.microsoft.com/playwright:v1.42.1-noble
# Step 2: Set the user to root to install dependencies without permission issues
USER root

# Step 3: Copy your package.json file first to leverage Docker cache
COPY package*.json ./

# Step 4: Install Node.js dependencies
RUN npm install

# Step 5: Install the Playwright browser binaries.
# This is crucial because npm install only installs the library, not the browsers.
RUN npx playwright install

# Step 6: Copy the rest of your source code (like main.js)
COPY . .

# Step 7: IMPORTANT: Switch back to the non-root user for security.
# The Apify base images use a user named 'myuser'.
USER myuser

# Step 8: Set the command to run your actor when the container starts
CMD [ "npm", "start" ]
