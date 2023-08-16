require("dotenv").config();//on utilise les paramètres dans l'autre fichier .env pour connecter à la base de données

const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

const connectionString = `postgres://db_for_users_user:wJ6AK625aUDWL0BGHYjKFv0HXg0GJtMt@dpg-cjejjqivvtos73a0dh10-a.oregon-postgres.render.com/db_for_users_oyjg?ssl=true`;

const pool = new Pool({
  connectionString: /*isProduction ? process.env.DATABASE_URL :*/ connectionString,
  ssl: isProduction
});

module.exports = { pool };
