# Use Node.js LTS image
FROM node:18

# Create app directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install

# Copy rest of the code
COPY . .

# Expose the port your app runs on
EXPOSE 5000

# Start the app
CMD ["npm", "start"]
