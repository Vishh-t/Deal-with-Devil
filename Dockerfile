# ---- Build stage ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
# Tests need a live PostgreSQL, so skip them in the image build
RUN mvn -q -B -DskipTests package

# ---- Run stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# Tuned for Render's free instance (512 MB RAM, 0.1 CPU):
# small heap, simple GC, quick JIT for faster startup.
# Render provides PORT; fall back to 8080 for local runs.
ENTRYPOINT ["sh", "-c", "exec java -Xmx300m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Dserver.port=${PORT:-8080} -jar app.jar"]
