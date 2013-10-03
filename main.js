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
var remote_hosts = config_options.remote_hosts || [];
var branch_map = config_options.branch_map || { 'master': '/var/apps' };
var git_user = config_options.git_user || 'deploy';
var git_command = config_options.git_command || '/usr/bin/git';
var sv_command = config_options.sv_command || '/usr/bin/sv';

app.use(express.bodyParser());

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

    if (!(branch in branch_map)) {
        console.log('we\'re ignoring pushes to the ' + branch + ' branch');
        if (payload['request_origin'] !== 'deploy_to_runit') {
            post_payload(payload);
        }
        return res.status(200).send('we\'re ignoring pushes to the ' + branch + ' branch');
    }

    console.log('Sending back 200 response');
    res.status(200).send('OK');

    repo = payload['repository']['name'];
    
    console.log("Going to repository: " + repo + "(" + branch + ")");
        
    process.chdir(branch_map[branch] + '/' + repo);

    run_command('chpst', ['-u', git_user, git_command, 'fetch'], function (err) {
        if (err) return handle_error(err, payload);
        run_command('chpst', ['-u', git_user, git_command, 'checkout', branch], function (err) {
            if (err) return handle_error(err, payload);
            merge(branch, payload, repo); 
        });
    });
});

var run_command = function (command, params, callback) {
    var cmd = child_process.spawn(command, params, { env: {} });
    cmd.stdout.pipe(process.stdout);
    cmd.stderr.pipe(process.stderr);
    cmd.on('exit', function (code) {
        if (code != 0) {
            return callback(new Error("Command: [" + command + " " + params.join(' ') + "] failed with exit code: " + code));
        }
        console.log("Command: [" + command + " " + params.join(' ') + "] successful");
        callback();
    });
}

var merge = function(branch, payload, repo) {
    run_command('chpst', ['-u', git_user, git_command, 'merge', 'origin/' + branch], function (err) {
        if (err) return handle_error(err, payload);
        env(payload, repo);
    });
}

var env = function(payload, repo) {
    fs.exists('env', function(exists) {
        if (!exists) {
            console.log('env does not exist');
        } else {
            fs.writeFile('env/LASTGITHASH', payload['after'], function (err) {
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
            if (err) return handle_error(err, payload);
            if (should_restart_server(payload)) {
                sv_restart(payload);
            }
            else {
                console.log('we\'ve been instructed not to restart the server');
                if (payload['request_origin'] !== 'deploy_to_runit') {
                    post_payload(payload, function (remote_posts) {
                        if (parse_branch_name(payload) === 'master') {
                            send_email(null, payload, remote_posts);
                        }
                    });
                }
            }
        });
    });
}

var sv_restart = function(payload) {
    run_command(sv_command, ['force-restart', '.'], function (err) {
        if (err) return handle_error(err, payload);
        console.log('Restarted');
        console.log('Thanks');

        if (payload['request_origin'] !== 'deploy_to_runit') {
            post_payload(payload, function (remote_posts) {
                if (parse_branch_name(payload) === 'master') {
                    send_email(null, payload, remote_posts);
                }
            });
        }
    });
}

var post_payload = function(payload, cb) {
    var remote_posts = [];

    console.log('posting payload to remote servers');

    // indicate that these POSTS originate from our servers, not Github
    payload['request_origin'] = 'deploy_to_runit';

    remote_hosts.forEach(function(remote_host) {
        if (remote_host['hostname'] !== os.hostname()) {
            var url = 'http://' + remote_host['hostname'] + ':' + (remote_host['port'] || port);
            request.post(url, {
                form: {payload: JSON.stringify(payload)}
            }, function(err, res, body) {
                if (err) return handle_error(err, payload);
                if (res.statusCode != 200) {
                    return handle_error("Non-200 status code returned from " + remote_host, payload);
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
    var email = { to: config_options.email_to };

    email.from = 'deploy: ' + os.hostname() + '<' + email.from + '>';

    var repo = payload['repository']['name'];

    if (err) {
        email.subject = 'Failed to deploy latest changes to ' + repo;
        email.text    = err.toString();
    }
    else {
        var push_time = new Date(payload['repository']['pushed_at'] * 1000).setTimezone(localtz).hours().toString("MMM d, yyyy, HH:mm");
        var deploy_time = new Date().setTimezone(localtz).hours().toString("MMM d, yyyy, HH:mm");
        var pusher = payload['pusher']['email'];
        var commits = payload['commits'].map(function (commit) {
            return {
                id      : commit.id.slice(0, 7),
                message : commit.message
            };
        }).reverse();

        email.subject = os.hostname() + ' deployed the latest changes to ' + repo + ': ' + payload['head_commit']['message'];

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
    var branch_match = /^refs\/heads\/(.*)$/.exec(payload['ref']);
    return branch_match && branch_match[1];
}

var should_restart_server = function(payload) {
    if (!config_options.dont_restart_server) return true;

    var repo = payload['repository']['name'];

    var dont_restart = config_options.dont_restart_server.some(function (val) {
        return val === repo;
    });

    return !dont_restart;
}

var handle_error = function(err, payload) {
    console.log(err);
    send_email(err, payload);
}

app.listen(port);
console.log('Now listening on port ' + port);
