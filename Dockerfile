# Use the specified Node.js version as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy foremost binary to the container
COPY foremost /app/foremost
RUN chmod +x /app/foremost

# Copy package.json and package-lock.json
COPY package*.json ./

# Install node dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Make port 3001 available to the world outside this container
EXPOSE 3001

# Define the command to run the application
CMD ["npm", "start"]
