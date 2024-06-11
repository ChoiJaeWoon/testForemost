# Use the specified Node.js version as a parent image
FROM node:20.12.2

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Make port 3001 available to the world outside this container
EXPOSE 3001

# Define the command to run the application
CMD ["npm", "start"]
