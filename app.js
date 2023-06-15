const bcrypt = require("bcrypt"); //encrypte mot de passe
const bodyParser = require('body-parser'); // le bodyParser est utile et agit comme middleware pour traiter des post et des get
const express = require('express');//simplifier la création de serveurs web en fournissant une bibliothèque légère et flexible pour gérer les requêtes et les réponses HTTP
const flash = require("express-flash");//message d'erreur
const rateLimit  = require('express-rate-limit');//limiter le taux de requêtes d'un utilisateur à une API ou un serveur, prévenant ainsi les abus ou les attaques de force brute.
const session = require("express-session");//gérer et maintenir les sessions utilisateur dans les applications web basées sur Express.js
const passport=require("passport");// permet de sécuriser l'accès aux données
const path = require('path');//manipuler et interagir avec les chemins de fichiers et de répertoires

const initializePassport=require("./passportConfig");
const { pool } = require("./dbConfig");
const { DateTime } = require("luxon");

const app = express();

var limiter = rateLimit ({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 1000, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers

});
initializePassport(passport);

// apply rate limiter to all requests
app.use(limiter);

// le bodyParser est utile et agit comme middleware pour traiter des post et des get
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());//on utilise des fichiers json
//importer les ressources externes
app.use(express.static(path.join(__dirname,'public')));
app.use(express.static(path.join(__dirname,'public/images')));
app.use(express.static(path.join(__dirname,'public/javascripts')));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.set("view engine", "ejs");
//ouvrir une session rapidement
app.listen(3000, () => {
  var url = `http://localhost:3000`
  console.log('Server listen on '+url);
  var start = (process.platform == 'darwin'? 'open': process.platform == 'win32' ? 'start' : 'xdg-open');
  require('child_process').exec(start + ' ' + url+'/acceuil');
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, '/acceuil.html'));
});
app.get('/about', function(req, res) {
  res.sendFile(path.join(__dirname, '/about.html'));
});
app.get('/users/initialization', function(req, res) {
  res.sendFile(path.join(__dirname, '/initialization.html'));
});

app.get('/users/register', checkAuthenticated, function(req, res) {
  res.render('register');
});
// on s'assure qu'il n'y a pas d'erreurs lors de l'inscription et on enregistre les infos dans la base de donnees
app.post('/users/register', async(req, res)=>{
  let { name, prenom,  email, password, password2,color } = req.body;
  let errors = [];
  if (!name || !prenom || !email || !password || !password2|| !color) {
    errors.push({ message: "Please enter all fields" });
  }

  if (password.length < 6) {
    errors.push({ message: "Password must be a least 6 characters long" });
  }

  if (password !== password2) {
    errors.push({ message: "Passwords do not match" });
  }
  else {//encryption mot de passe et on s'assure que chaque user a un email unique
    hashedPassword = await bcrypt.hash(password, 10);
    console.log(hashedPassword);
    // Validation passed
    pool.query(
      `SELECT * FROM cookartusers
        WHERE email = $1`,
      [email],
      (err, results) => {
        if (err) {
          console.log(err);
        }
        console.log("step 1");
        if (results.rows.length > 0||errors.length > 0) {
          if(errors.length<1)
            errors.push({ message: "Email already registered!" });
          return res.status(404).render("register", { errors, name, prenom , email, password, password2, color });
        }
        else{
          pool.query(
            `INSERT INTO cookartusers (name, prenom, email, password, color)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, password`,
            [name, prenom, email, hashedPassword, color],
            (err, results) => {
              if (err) {
                throw err;
              }
              console.log("step 2");
              req.flash("success_msg", "You are now registered. Please log in");
              res.redirect("/users/login");
            }
          );
        }
      }
      );
    }
});

app.get('/users/login', checkAuthenticated, function(req, res) {
  res.render("login");
});
//L'URL de la redirection dépend si l'authentification a marché ou non
app.post(
  "/users/login",
  passport.authenticate("local", {
    successRedirect: "/users/dashboard",
    failureRedirect: "/users/login",
    failureFlash: true
  })
);//le POST delete suprrime le projet selon index souhaitée et supprime la date de sauvegarde de ce projet
app.post('/delete', async(req, res) => {
  var itemId = req.body.itemId;
  try {
      await pool.query(
        `UPDATE cookartusers
        SET details[$2]= null 
        WHERE email = $1`, [req.user.email, itemId] 
      );
      await pool.query(
        `UPDATE cookartusers
        SET lastsave[$2]= null 
        WHERE email = $1`, [req.user.email, itemId] 
      );
      await pool.query(
        `UPDATE cookartusers
        SET details= array_remove(details, NULL) 
        WHERE email = $1`, [req.user.email] 
      );
      await pool.query(
        `UPDATE cookartusers
        SET lastsave= array_remove(lastsave, NULL) 
        WHERE email = $1`, [req.user.email] 
      );
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  res.redirect("/users/dashboard");
});
//Le POST query enregistre le projet et sa date de sauvegarde en considérant si c'est un nouveau ou un ancien projet
app.post('/query', async(req, res) => {
  let projets;
  try {
    const result = await pool.query(
      'SELECT details FROM cookartusers WHERE email = $1',
      [req.user.email]
    );  
    projets = result.rows[0].details;
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  let idTest = req.body.id;
  let index =-1;
  if (projets!=null)
    index = projets.findIndex(element => element.id ==idTest);

    // Get the current date and time in the user's local time zone
    var now = DateTime.now().setZone("America/Montreal")
    
    // Format the date and time as a string in the user's local time zone
    var localDateTimeString = now.toLocaleString(DateTime.DATETIME_MED);
    
  //A chaque qu'on save, on s'assure qu'on n'avait pas save le meme circuit precedemment
  try {
    if(index!=-1){//On remplace le projet déjà crée par sa nouvelle valeur
      await pool.query(
        `UPDATE cookartusers
        SET details[$3]= $1 
        WHERE email = $2`, [JSON.stringify(req.body).replace(/([a-zA-Z0-9_]+?):/g, '"$1":'), req.user.email, index] 
      );
      await pool.query(
        `UPDATE cookartusers
        SET lastsave[$3]= $1 
        WHERE email = $2`, [localDateTimeString, req.user.email, index] 
      );
    }else{// On crée un nouveau projet dans le array details qui contient toutles projets
      await pool.query(
        `UPDATE cookartusers
        SET details=array_append(details, $1) 
        WHERE email = $2`, [JSON.stringify(req.body).replace(/([a-zA-Z0-9_]+?):/g, '"$1":'), req.user.email] 
      );
      await pool.query(
        `UPDATE cookartusers
        SET lastsave=array_append(lastsave, $1) 
        WHERE email = $2`, [localDateTimeString, req.user.email] 
      );   
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  res.sendStatus(200);
});
app.post('/search', async (req, res) => {
  const searchTerm = req.body.search; // Get the search term from the form submission
  const tableContents = await pool.query('SELECT * FROM cookartusers');
  const rows=tableContents.rows;
  // Perform the database query
  const query = 'SELECT * FROM cookartusers WHERE name ILIKE $1';
  pool.query(query, [`%${searchTerm}%`])
    .then((result) => {
      const searchResults = result.rows;
      res.render('explore', { 
        user:{
          columns: rows,
          results: searchResults
        }
       });
    })
    .catch((error) => {
      console.error('Error executing search query:', error);
      res.status(500).send('Internal Server Error');
    });
});
app.get('/explore', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cookartusers');
    const rows=result.rows;
    console.log(rows);
    res.render('explore', {user:{
      columns: rows,
      results: null
    } });
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Error');
  }
});
app.get("/users/logout", async (req, res) => {
  try {
    const result = await pool.query(
      'update cookartusers set status=false where email = $1',
      [req.user.email]
    );
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  req.logout(function(err) {
    if (err) { return next(err); }
    req.flash("success_msg", "You have logged out");
    res.redirect("/");
  });
});//Pour le GET dashboard, on donne un id, nom, prénom, projets, couleur et moments de sauvegardes au fichier dashboard.ejs
app.get('/users/dashboard', checkNotAuthenticated, async(req, res)=> {
  let projets;
  try {
    const result = await pool.query(
      'SELECT details FROM cookartusers WHERE email = $1',
      [req.user.email]
    );
    projets = result.rows[0].details;
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  try {
    const result = await pool.query(
      'update cookartusers set status=true where email = $1',
      [req.user.email]
    );
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.sendStatus(500);
  }
  res.render("dashboard", {user:{
    id:req.user.email,
    name:req.user.name,
    prenom:req.user.prenom,
    projets: projets,
    color: req.user.color,
    lastsaves: req.user.lastsave,
  } });
});
app.get('/acceuil', function(req, res) {
  res.redirect('/');
});
app.get('/editeur', checkAuthenticatedForEditor,function(req, res) {
});
//On ouvre le projet selon le id du circuit que le user souhaite ouvrir à partir du dashboard(id est la date de sauvegarde)
app.get('/users/editeur/:id',function(req, res) {
     console.log();
    res.render("editeur", {
      user:{
        name:req.user.name,
        prenom:req.user.prenom,
        color:req.user.color,
      },
      projet:req.user.details.find(element => element.id == req.params.id ) 
    });
});


function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/users/dashboard");
  }
  next();
}//L'éditeur reçoit le nom prenom et la couleur choisie
function checkAuthenticatedForEditor(req, res) {
  if (req.isAuthenticated())
    res.render("editeur", {user:{
      name:req.user.name,
      prenom:req.user.prenom,
      color:req.user.color,
    } });
  else
    return res.redirect(path.join(__dirname, '/'));
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/users/login");
}

