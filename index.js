const app = require('express')();
const path = require('path');
const fs = require('fs');
const openapi = require('express-openapi');
const cors = require('cors');
const octokit = require('@octokit/rest')();
const LRU = require('lru-cache');

// Load configuration, secrets
const config_port = process.env.PORT ? process.env.PORT : 9999;
const config_gh_key = process.env.GH_KEY;

if(!config_gh_key){
    console.error("Huh?");
    process.exit(1);
}

// Auth services
octokit.authenticate({type: "token", token: config_gh_key});


// Common result handlers
function unknown_service(req, res){
    res.status(404).json({err: "Unknown service"});
}
function unknown_repository(req, res){
    res.status(404).json({err: "Unknown repository/reference"});
}
function resolve_ref(req, res, ref){
    res.json({ref: ref});
}

// Caching
var ref_cache = LRU({ max: 5000, maxAge: 1000 * 5});
function ref_cache_getkey(service, user, repo, head){
    return service + "/" + user + "/" + repo + "/" + head;
}
function ref_cache_enter(service, user, repo, head, ref){
    if(service && user && repo && head && ref){
        ref_cache.set(ref_cache_getkey(service,user,repo,head),
                      ref);
    }
}
function ref_cache_read(service, user, repo, head){
    if(service && user && repo && head){
        var r = ref_cache.get(ref_cache_getkey(service,user,repo,head));
        if(r){
            return r;
        }else{
            return false;
        }
    }else{
        return false;
    }
}


// Path handlers
const resolve = {
    get: function(req, res){
        const service = req.params.service;
        const repo = req.params.repo;
        const user = req.params.user;
        const origref = req.query.ref;
        if(!req.query.ref){
            // FIXME: default to "master" ??
            unknown_repository(req, res);
        }else{
            const cached = ref_cache_read(service, user, repo, origref);
            if(cached){
                resolve_ref(req, res, cached);
            }else if(service == "gh"){
                var ref = "heads/" + req.query.ref;
                function cb(error, apiresult){
                    if(error){
                        unknown_repository(req, res);
                    }else{
                        if(apiresult.data && apiresult.data.object
                           && apiresult.data.object.type == "commit"){
                            ref_cache_enter("gh", user, repo, origref,
                                            apiresult.data.object.sha);
                            resolve_ref(req, res, apiresult.data.object.sha);
                        }else{
                            unknown_repository(req, res);
                        }
                    }
                }
                octokit.gitdata.getReference({owner: user, 
                                             repo: repo, 
                                             ref: ref}, cb);
            }else{
                    // Unknown service
                    unknown_service(req, res);
            }
        }
    }
};

const pathderef = {
    get: function(req, res){
        // Unknown service
        unknown_service(req, res);
    }
};

// Configure server

const cors_options = {
    origin: "*", // FIXME: Arrange this
    methods: "GET"
};

app.use(cors(cors_options));

const openapi_args = {
    apiDoc: fs.readFileSync(path.resolve(__dirname, "api.json"), "utf8"),
    app: app,
    paths: [
        { 
            path: "/{service}/{user}/{repo}/resolve",
            module: resolve
        },
        {
            path: "/{service}/{user}/{repo}/pathderef",
            module: pathderef
        }
          
    ]
};

openapi.initialize(openapi_args);

app.disable("etag"); // As an API server, it's waste of time
app.listen(config_port);

console.log("Listening at", config_port);
