# CoParent Backend

This project is a backend service for the CoParent application, built using [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and PostgreSQL. It runs in a Dockerized environment using `docker-compose`.

---

## 🧱 Project Structure

coparent/
├── coparent-backend/ # NestJS backend project
│ ├── src/ # Source code
│ ├── prisma/ # Prisma schema and migrations
│ ├── Dockerfile # Docker build file for backend
│ └── ...
├── docker-compose.yml # Docker Compose configuration
└── README.md # Project instructions

---

## 🚀 Getting Started

### ✅ Prerequisites

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

---

## 🐳 Running the Project

### 1. Clone the Repository

git clone <your-repo-url>
cd coparent 2. Start Services with Docker Compose

docker-compose up --build
This will:

Start a PostgreSQL container on port 5432

Build and run the NestJS backend server on port 3000

You should now be able to access the backend at:

http://localhost:3000
🛠 Environment Variables
The backend expects a valid PostgreSQL connection string in the format:

DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
This is injected in docker-compose.yml and passed to the container via:

environment:
DATABASE_URL: postgresql://postgres:prisma@postgres:5432/postgres
🧪 Useful Commands
Run Migrations
If you make changes to your Prisma schema, run:

docker exec -it coparent-backend npx prisma migrate dev --name <migration-name>
Open Prisma Studio (optional GUI)

docker exec -it coparent-backend npx prisma studio
🧹 Cleanup
To stop and remove all containers and volumes:

docker-compose down -v
🧾 Notes
Database volume is stored persistently using Docker volumes under pg_data

Code changes will auto-reload in development mode (npm run start:dev)

Prisma migrations and seed data should be added to the coparent-backend/prisma/ folder

## 🧪 Initial Setup (Local Development)

After running `docker-compose up --build`, run the following commands:

1. Apply database schema and migrations:

docker exec -it coparent-backend npx prisma migrate dev --name init
Generate the Prisma client (if needed):

docker exec -it coparent-backend npx prisma generate
(Optional) Open Prisma Studio:

docker exec -it coparent-backend npx prisma studio
Access it at: http://localhost:5555

There is a seed.ts file in the prisma folder which can be used to add some users to the db by running:
docker exec -it coparent-backend npx ts-node prisma/seed.ts
inside the coparent-backend Docker container

📦 Tech Stack
Backend: NestJS

ORM: Prisma

Database: PostgreSQL (via Docker)

Runtime: Node.js (v18+)

📮 Contact
For questions or contributions, please raise an issue or contact the project maintainers.

```

```
