'use strict';

var express = require('express');
var router  = express.Router();
var auth    = require('./Auth.js');
var bcrypt  = require('bcrypt-nodejs');

var Spot    = require('../Models/Spot.js').Spot;
var User    = require('../Models/User.js').User;
var Search  = require('../Models/Search.js').Search;


/**   API Router (v1): handles all requests for the 1st version of the API
  *   ROUTE: /api/v1
  *
  *
  *   OVERVIEW:
  *
  *   - get/create/edit/delete Spots
  *   - get/create/edit/delete Account (User)
  *   - search (save searchTerm, return result)
  */

/**
  *   TEST API CALL: output API version
  */
router.get("/", function(req, res, next) {
  res.json({APIversion: "v1"});
});


/**
  *   AUTHENTICATION REQUIRED: setting up Authentication middleware here
  */
router.use(auth);

/**
  *   BIND PARAMS:  for easy to use IDs: get the object immediately, without any "findById" in future calls
  */

  // SPOT
router.param("spotID", function(req, res, next, id) {
  Spot.findOne({_id: req.params.spotID, deletedAt: null}, { __v: 0 }, function(err, spot) {

    if(err) return next(err);

    if(!spot) {
      err = new Error("Spot not found");
      err.status = 404;
      return next(err);
    }

    req.spotOwner = ("" + spot._user_id) === ("" + req.user._id);

    req.spot = spot;
    return next();
  });
});

  //ACCOUNT
router.param("accID", function(req, res, next, id) {
  User.findById(req.params.accID, function(err, user) {

    if(err) return next(err);

    if(("" + user._id) != ("" + req.user._id)) {
      err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    if(!user) {
      err = new Error("Account not found");
      err.status = 404;
      return next(err);
    }

    req.user = user;
    return next();
  });
});


/**
  *   SPOT: get (POST /spot/:id), create (POST /spot), edit (PUT /spot/:id), (soft) delete (DELETE /spot/:id)
  *   SPOTS: get all spots that the user has created (and only those)
  */
router.post("/spot/:spotID", function(req, res, next) {

  res.json(req.spot);
})

router.post("/spot", function(req, res, next) {

  req.body._user_id = req.user._id;

  var spot = new Spot(req.body);
  spot.save(function(err, spot) {             //TODO do not return __v

    if(err) return next(err);

    res.status(201);
    res.json(spot);
  });
});

router.put("/spot/:spotID", function(req, res, next) {

  checkOwner(req, next);

  req.spot.update(req.body, function(err, spot) {             //TODO do not return __v

    if(err) return next(err);

    res.json(spot);
  })
});

router.delete("/spot/:spotID", function(req, res, next) {

  checkOwner(req, next);

  req.spot.delete(function(err) {
    if(err) return next(err);

    res.status(204);
    res.json({});
  });
});

router.post("/spots", function(req, res, next) {

  Spot.find({_user_id: req.user._id, deletedAt: null}, { __v: 0 }, function(err, spots) {

    if(err) next(err);

    if(!spots) {

      var err = new Error("No spots");
      err.status = 404;
      return next(err);
    }

    res.json({
      "spots": spots
    });
  })
});

/**
  *   ACCOUNT: get (POST /acc/:id), edit (PUT /acc/:id), (soft) delete (DELETE /acc/:id)
  */
router.post("/acc/:accID", function(req, res, next) {

  res.json({
    _id: req.user._id,
    email: req.user.email,
    firstname: req.user.firstname,
    lastname: req.user.lastname,
    roles: req.user.roles,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt
  });
});

router.put("/acc/:accID", function(req, res, next) {

  var email = req.body.email;
  var old_password = req.body.old_password;
  var accID = req.body.Credentials.accID;

  User.findOne({ email: email, deletedAt: null }, function(err, user) {

    var emailExistsAlready = true;

    if(!user) {
      emailExistsAlready = false;
    } else if((user._id + "") == (accID + "")) {
      emailExistsAlready = false;
    }

    if(emailExistsAlready) {

      var err = new Error('Email Error: email already exists');
      err.status = 400;
      return next(err);

    } else {

      User.findOne({ _id: accID, deletedAt: null }, function(err, user) {

        if(err) next(err);

        if(!user) {

          var err = new Error('Login Error: account does not exists');
          err.status = 403;
          return next(err);
        }

        if(bcrypt.compareSync(old_password, user.password)) {

          req.user.change(req.body, function(err, user) {

            if(err) next(err);

            res.status(204);
            res.json({});
          });

        } else {

          var err = new Error('Login Error: wrong password');
          err.status = 403;
          return next(err);
        }
      });
    }
  });
});

router.delete("/acc/:accID", function(req, res, next) {

  var password = req.body.password;
  var accID = req.body.Credentials.accID;

  User.findOne({ _id: accID, deletedAt: null }, function(err, user) {

    if(err) next(err);

    if(!user) {

      var err = new Error('Login Error: account does not exists');
      err.status = 403;
      return next(err);
    }

    if(bcrypt.compareSync(password, user.password)) {

      req.user.delete(function(err) {

        if(err) next(err);

        res.status(204);
        res.json({});
      });

    } else {

      var err = new Error('Login Error: wrong password');
      err.status = 403;
      return next(err);
    }
  });
});

/**
  *   SEARCH with geolocation:
  *
  *   searches for all spots that are in the radius of the circle around the position: {lat, lng}
  *
  *   @param  lat
  *   @param  lng
  *   @param  radius (not relevant in V1, but maybe in future versions)
  *
  *   @return array of found spots (length could be 0)
  */
router.post("/search/geo", function(req, res, next) {

  var lat = req.body.lat;
  var lng = req.body.lng;

  var borderRadius = 0.1;

  var latBorderLeft   = lat - borderRadius;
  var latBorderRight  = lat + borderRadius;
  var lngBorderLeft   = lng - borderRadius;
  var lngBorderRight  = lng + borderRadius;

  //get all spots that are within the border

  Spot.find({
     $and: [
       {lat: { $gt: latBorderLeft, $lt: latBorderRight}},
       {lng: { $gt: lngBorderLeft, $lt: lngBorderRight}}
    ]
  },
  {
    __v: 0
  },
  function(err, spots) {

    if(err) next(err);

    res.json({
      "spots": spots
    });
  });
});

/**
  *   IMPORTANT: NOT SUPPORTED IN V1 -> NO DATA IN DB, use google maps api, ADDING DATA IS POSSIBLE (SEE BELOW)
  *   SEARCH with name of place AND street name:
  *   @param  place
  *   @param  name
  *   @param  radius
  *
  *   @return array of found spots (length could be 0)
  */
router.post("/search/name", function(req, res, next) {

  res.json({});
});

/**
  *   ADD SEARCH:
  *   @param  place
  *   @param  name
  *   @param  lat
  *   @param  lng
  *
  *   @return void
  */
router.post("/search/add", function(req, res, next) {

  req.body.search._user_id = req.user._id;

  Search.findOne(req.body.search, function(err, search) {

    if(err) next(err);

    if(!search) {

      var search = new Search(req.body.search);
      search.save(function(err, search) {

        if(err) return next(err);

        res.status(201);
        res.json(search);
      });

    } else {

      search.incSearchAmount(function(err, search) {

        if(err) next(err);

        res.status(200);
        res.json(search);
      });
    }
  });
});


function checkOwner(req, next) {

  if(!req.spotOwner) {

    var err = new Error("Forbidden");
    err.status = 403;
    return next(err);
  }
}

module.exports = router;
