require('datejs'); // supplements Date
var util          = require('util');
var os            = require('os');
var express       = require('express');
var app           = express();
var child_process = require('child_process');
var fs            = require('fs');
var request       = require('request');
var nodemailer    = require('nodemailer');

var mail_transport = nodemailer.createTransport("SMTP", JSON.parse(fs.readFileSync(__dirname + '/config/smtp_transport.json', 'utf8')));

var port          = process.env['PORT'] || 10001;
var localtz       = process.env['LOCALTIMEZONE'] || 'UTC';

var config_options = JSON.parse(fs.readFileSync(__dirname + '/config/main.json', 'utf8'));
if (!config_options.email_to) throw "No email_to setting in main.json";
if (!config_options.email_from) throw "No email_from setting in main.json";

var request_queue = [];

app.use(express.bodyParser());

fs.watch(__dirname + '/config/main.json', {persistent: false}, function () {
    console.log("Reloading main.json");
    config_options = JSON.parse(fs.readFileSync(__dirname + '/config/main.json', 'utf8'));
    if (!config_options.email_to) throw "No email_to setting in main.json";
    if (!config_options.email_from) throw "No email_from setting in main.json";
});

fs.watch(__dirname + '/config/smtp_transport.json', {persistent: false}, function () {
    console.log("Reloading smtp_transport.json");
    mail_transport = nodemailer.createTransport("SMTP", JSON.parse(fs.readFileSync(__dirname + '/config/smtp_transport.json', 'utf8')));
});

app.post('/', function (req, res) {
    var payload;
    var repo;
    var payload_branch_matches;
    var branch;
    
    payload = req.body.payload;
    if (!payload) { 
        console.log("Stop sending me rubbish");
        return res.status(200).send('Stop sending me rubbish');
    }

    payload = JSON.parse(payload);
    console.log('I\'ve got some JSON: ' + util.inspect(payload));

    branch = parse_branch_name(payload);
    repo = payload.repository.name;

    var branch_map = get_config(payload, 'branch_map', { 'master': '/var/apps' });
    if (!(branch in branch_map)) {
        console.log('we\'re ignoring pushes to the ' + branch + ' branch for repo: ' + payload.repository.name);
        if (payload.request_origin !== 'deploy_to_runit') {
            post_payload(payload);
        }
        return res.status(200).send('we\'re ignoring pushes to the ' + branch + ' branch for repo: ' + payload.repository.name);
    }

    console.log('Sending back 200 response');
    res.status(200).send('OK');

    // add request to queue
    request_queue.push({
        payload: payload,
        branch:  branch,
        repo:    repo
    });

    if (request_queue.length === 1) {
        start();
    }
});

var start = function() {
    var item    = request_queue[0];
    var payload = item.payload;
    var branch  = item.branch;
    var repo    = item.repo;
    
    console.log("Going to repository: " + repo + "(" + branch + ")");

    var test_map = get_config(payload, 'test_map', {});

    if (test_map[branch]) {
        process.chdir(test_map[branch] + '/' + repo);

        return run_tests(branch, payload, repo);
    }

    return run_live(branch, payload, repo);
}

var run_tests = function (branch, payload, repo) {
    git_fetch_checkout(branch, payload, repo, function (err) {
        if (err) return handle_error(err, payload, next_queue_item);
        run_git(payload, ['merge', 'origin/' + branch], function (err) {
            if (err) return handle_error(err, payload, next_queue_item);
            prerun_test(branch, payload, repo);
        });
    });
}

var prerun_test = function (branch, payload, repo) {
    fs.exists('pre-run', function (exists) {
        if (!exists) {
            return run_the_tests(branch, payload, repo);
        }
        console.log('Executing pre-run file');
        run_command('./pre-run', [], function (err) {
            if (err) return handle_error(err, payload, next_queue_item);
            run_the_tests(branch, payload, repo);
        });
    });
}

var run_the_tests = function (branch, payload, repo) {
    var test_command = get_config(payload, 'test_command', 'make test');
    run_command(test_command, [], function (err) {
        if (err) return handle_error(err, payload, next_queue_item);
        // Tests passed.
        console.log("Tests passed. Installing live.");
        run_live(branch, payload, repo);
    });
}

var run_live = function (branch, payload, repo) {
    var branch_map = get_config(payload, 'branch_map', { 'master': '/var/apps' });
    process.chdir(branch_map[branch] + '/' + repo);

    git_fetch_checkout(branch, payload, repo, function (err) {
        if (err) return handle_error(err, payload, next_queue_item);
        merge(branch, payload, repo);         
    })
}

var git_fetch_checkout = function (branch, payload, repo, cb) {
    run_git(payload, ['fetch'], function (err) {
        if (err) return cb(err);
        run_git(payload, ['checkout', branch], cb);
    });
}

var run_git = function (payload, options, cb) {
    var git_user = get_config(payload, 'git_user', 'deploy');
    var git_command = get_config(payload, 'git_command', '/usr/bin/git');
    var command = ['-u', git_user, git_command].concat(options);
    run_command('chpst', command, cb);
}

var run_command = function (command, params, callback) {
    var callback_called = false;
    if (/\s/.test(command)) {
        var command_list = command.split(/\s+/);
        command = command_list.shift();
        params = command_list.concat(params);
    }
    var cmd = child_process.spawn(command, params, { env: {} });
    cmd.stdout.pipe(process.stdout);
    cmd.stderr.pipe(process.stderr);
    cmd.on('error', function (err) {
        if (callback_called) return console.log("Error from command:", err);
        callback_called = true;
        return callback(new Error("Command: [" + command + " " + params.join(' ') + "] failed with error:" + err));
    });
    cmd.on('exit', function (code) {
        if (callback_called) {
            return console.log("Exit after callback already called");
        }
        callback_called = true;
        if (code != 0) {
            return callback(new Error("Command: [" + command + " " + params.join(' ') + "] failed with exit code: " + code));
        }
        console.log("Command: [" + command + " " + params.join(' ') + "] successful");
        callback();
    });
}

var merge = function(branch, payload, repo) {
    run_git(payload, ['merge', 'origin/' + branch], function (err) {
        if (err) return handle_error(err, payload, next_queue_item);
        env(payload, repo);
    });
}

var env = function(payload, repo) {
    fs.exists('env', function(exists) {
        if (!exists) {
            console.log('env does not exist');
        } else {
            fs.writeFile('env/LASTGITHASH', payload.after ? payload.after : payload.commits[payload.commits.length - 1].raw_node, function (err) {
                if (err) {
                    console.log(err);
                }
            });
        }
        console.log('Live deploy to ' + repo);
        prerun(payload);
    });
}

var prerun = function(payload) {
    fs.exists('pre-run', function (exists) {
        if (!exists) {
            return sv_restart(payload);
        }
        console.log('Executing pre-run file');
        run_command('./pre-run', [], function (err) {
            if (err) return handle_error(err, payload, next_queue_item);
            if (should_restart_server(payload)) {
                sv_restart(payload);
            }
            else {
                console.log('we\'ve been instructed not to restart the server');
                if (payload.request_origin !== 'deploy_to_runit') {
                    post_payload(payload, function (remote_posts) {
                        if (parse_branch_name(payload) === 'master') {
                            send_email(null, payload, remote_posts);
                        }
                    });
                }
                next_queue_item();
            }
        });
    });
}

function get_config (payload, key, def) {
    var repo = payload.repository.name;

    // Per-project config
    if (config_options.projects && config_options.projects[repo] && config_options.projects[repo][key]) {
        return config_options.projects[repo][key];
    }
    if (config_options[key]) {
        return config_options[key];
    }
    return def;
}

var sv_restart = function(payload) {
    var restart_command = get_config(payload, 'restart_command', 'force-restart');
    var sv_command = get_config(payload, 'sv_command', '/usr/bin/sv');
    run_command(sv_command, [restart_command, '.'], function (err) {
        if (err) return handle_error(err, payload, next_queue_item);
        console.log('Restarted');
        console.log('Thanks');

        if (payload.request_origin !== 'deploy_to_runit') {
            post_payload(payload, function (remote_posts) {
                if (parse_branch_name(payload) === 'master') {
                    send_email(null, payload, remote_posts);
                }
            });
        }
        next_queue_item();
    });
}

var post_payload = function(payload, cb) {
    var remote_posts = [];

    console.log('posting payload to remote servers');

    // indicate that these POSTS originate from our servers, not Github
    payload.request_origin = 'deploy_to_runit';

    var remote_hosts = get_config(payload, 'remote_hosts', []);

    remote_hosts.forEach(function(remote_host) {
        if (remote_host['hostname'] !== os.hostname()) {
            var url = 'http://' + remote_host['hostname'] + ':' + (remote_host['port'] || port);
            request.post(url, {
                form: {payload: JSON.stringify(payload)}
            }, function(err, res, body) {
                // dont try to process next queue item on these errors
                // because we already called it
                if (err) return handle_error(err, payload, null);
                if (res.statusCode != 200) {
                    return handle_error("Non-200 status code returned from " + remote_host, payload, null);
                }
                console.log('successfully posted to ' + url);
            });
            remote_posts.push(remote_host['hostname']);
        }
    });

    if (cb) {
        cb(remote_posts);
    }
}

var send_email = function(err, payload, remote_posts) {
    var email = { to: get_config(payload, 'email_to') };

    email.from = '"deploy:' + os.hostname() + '" <' + get_config(payload, 'email_from') + '>';

    var repo = payload.repository.name;

    if (err) {
        email.subject = 'Failed to deploy latest changes to ' + repo;
        email.text    = err.toString();
    }
    else {
        var push_time = payload.repository.pushed_at ? 
                            new Date(payload.repository.pushed_at * 1000).setTimezone(localtz).hours().toString("MMM d, yyyy, HH:mm") :
                            new Date();
        var deploy_time = new Date().setTimezone(localtz).hours().toString("MMM d, yyyy, HH:mm");
        var pusher = payload.pusher ? payload.pusher.email : payload.user;
        var commits = payload.commits.map(function (commit) {
            return {
                id      : commit.id ? commit.id.slice(0, 7) : commit.node,
                message : commit.message
            };
        }).reverse();

        email.subject = os.hostname() + ' deployed the latest changes to ' + repo + ': ' + 
                        (payload.head_commit ? payload.head_commit.message : payload.commits[payload.commits.length - 1].message);

        email.text    = os.hostname() + ' deployed the latest changes to ' + repo + '\n'
                         + 'we also posted the payload to the following remotes: ' + remote_posts.join(', ') + '\n\n'
                         + 'Push time: ' + push_time + '\n'
                         + 'Pushed by: ' + pusher + '\n\n'
                         + 'Commits: ' + '\n'
        commits.forEach(function (commit) {
            email.text += commit.id + ': ' + commit.message + '\n'
        });
    }
    
    mail_transport.sendMail(email, function (error, response) {
        if (error) {
            console.log("Sending mail failed: " + error);
        }
        else {
            console.log("Email sent: " + response.message);
        }
    });
}

var parse_branch_name = function(payload) {
    var branch_match = /^refs\/heads\/(.*)$/.exec(payload.ref);
    if (branch_match) {
        return branch_match[1];
    }
    // Otherwise came from bitbucket...
    // Since bitbucket might send >1 POST per push, we just return first branch
    // TODO: fix this - we'd need to loop once for each branch potentially.
    for(var i = payload.commits.length - 1; i >= 0; i--){
        var branch = payload.commits[i].branch;
        // console.log("Branch: "+branch);
        if (branch) return branch;
    }
}

var should_restart_server = function(payload) {
    var dont_restart = get_config(payload, 'dont_restart_server');
    if (!dont_restart) return true;

    var repo = payload.repository.name;

    if (typeof dont_restart == 'array') {
        dont_restart = dont_restart.some(function (val) {
            return val === repo;
        });
    }

    return !dont_restart;
}

var handle_error = function(err, payload, next_queue_item) {
    console.log(err);
    send_email(err, payload);
    if (next_queue_item) next_queue_item();
}

var next_queue_item = function() {
    request_queue.shift();
    if (request_queue.length) {
        console.log('Processing next queue item');
        start(); 
    }
}

app.listen(port);
console.log('Now listening on port ' + port);
