deploy_to_runit
===============

Deploy from github webhooks to a server using [runit](http://smarden.org/runit/)

Introduction
------------

Runit is an extremely reliable way of keeping services running. Think of it
like upstart or forever or pm2, but more reliable, a better pedigree, and
with better options for logging and user management.

This application allows you to auto-deploy runit services from Github.

Setting deploy_to_runit up
--------------------------

The first step is to fork this project. This makes it possible for you to
have deploy_to_runit auto-update when you merge in changes from the master
repository. This also serves as a great example of how to set up your own
projects.

Next we pick a folder which is the base of our running applications on our
server. The default is /var/apps.

Next pick a system user to use for git pulls - the default name of this user
is "deploy". Let's set this user up with the following steps:

* Create a user accout on the system
* Set permissions for /var/apps
* Create an ssh key for the user

On Ubuntu this would be (as root):

    # useradd -d /var/apps -s /bin/bash deploy
    # chown -R deploy /var/apps
    # su - deploy
    $ mkdir .ssh
    $ ssh-keygen

Don't set a passcode for the SSH key.

Now there are several ways to allow that user and SSH key access to your
Github repository. [This document](https://help.github.com/articles/managing-deploy-keys)
details the ways to do this. For private projects I tend to prefer the last
option as it allows you to have a user with Read-Only access to your repository,
but for simple uses, just add the new SSH key as a deploy key to your project.

Note you don't need to add the deploy key to public repositories (like this
one, assuming you forked it).

Now let's clone this project (assuming we are still the "deploy" user):

NOTE: Change this to your own fork, and use the https URL.

    $ git clone https://github.com/baudehlo/deploy_to_runit.git

And then install the dependencies:

    $ cd deploy_to_runit
    $ npm install

Now we need to set two configuration options - your outbound email settings
which are in config/smtp\_transport.json, and an email address to receive emails
when new software is deployed. Add the keys `email\_to` and `email\_from` to
the file config/main.json.

The `email\_to` parameter can be a comma separated list if you need multiple
addresses to receive deployment emails.

Now we can check if it will run:

    $ ./run

If it all works, you should see "Now listening on port 10001".

Now we need to get it running as a service. Do this as root:

    # ln -s /var/apps/deploy_to_runit /etc/service/
    # sv status /var/apps/deploy_to_runit/

It should show that deploy_to_runit is running (as is the logger).

Now open up your firewall to the Github webhook IP addresses to port 10001.

Then add in the server as a webhook, and click test while tailing the logs.

Configuration
-------------

The smtp_transport.json is just a JSON representation of the settings available
to nodemailer at https://github.com/andris9/Nodemailer#setting-up-smtp

Warning - do not commit your password to github when you setup a fork of
deploy_to_runit as it will be visible to all. If you need to do that, make it
a private repository, but you really shouldn't anyway. Make that part of some
other configuration system such as Chef.

In main.json the following options are available:

* email_to (required) - the email to send success/failure messages to
* email_from (required) - the email address messages are from
* branch_map - a hash of branch to root folder name mappings. Default: `{"master": "/var/apps"}`
* test_map - a hash of branch to test folder name distinct from those in branch_map. Default: `{}`
* remote_hosts - a list of remote hosts to send the payload to (for multi-server deployment). Default: []
* git_user - the username to run commands as. Default: deploy
* git_command - the path to git. Default: /usr/bin/git
* sv_command - the path to "sv". Default: /usr/bin/sv
* test_command - the command to run for testing. Default: "make test"
* restart_command - the command passed to "sv" to restart the server. Default: force-restart
* dont_restart_server - a list of projects not to restart after updating. Default: []

All options can also appear under a "projects" key which takes the following
form:

    "projects": {
        "project-1": {
            "restart_command": "sigusr2"
        },
        "project-2": {
            "dont_restart_server": true
        }
    }

(note there that "dont_restart_server" can be boolean at that level)

Multi-Server Deployment
-----------------------

To deploy to multiple servers, have one main deployment server receiving from Github,
and then fan out that deployment to your other servers, after your "pre-run" has
successfully run (allowing you to "stage" your update). To do this add the
`remote_hosts` configuration option as follows:

    "remote_hosts": [
        { "hostname": "app1" },
        { "hostname": "app2" },
        { "hostname": "app3" },
        { "hostname": "app4" },
        { "hostname": "app5" }
    ]

Now just run deploy_to_runit on all 5 servers, but have Github point at just
one (feel free to load balance where it goes first). Then once successfully
updated and pre-run has run OK, it will deploy to the other servers (with a
flag that tells them not to re-deploy it).

Branches
--------

By default deploy_to_runit deploys the "master" branch, though this can be
changed, as can deciding to have a folder which runs the "staging" branches
of your projects. Simply setup the branch_map as follows:

    "branch_map": {
        "master": "/var/apps",
        "staging": "/var/staging-apps"
    }

And make sure you checkout the staging branch of your apps into the
/var/staging-apps folder.

Testing
-------

If you specify a `test_map`, you can elect to have your project tested before
updating it in the live folder (which can dangerously overwrite files).

    "test_map": {
        "master": "/var/apps/master-qa",
        "staging": "/var/apps/staging-qa"
    }

When this a key exists for this, the project will be fetched in that folder,
and the `test_command` will be run for that project. If this command exits
with a non-zero exit status, an email will generated and we will not continue
to deploy it. The `pre-run` command will be executed before testing begins.

Thanks
------

Thanks to Hubdoc (http://www.hubdoc.com/) for releasing this open source.

License
-------

This project is released under the MIT license as follows:

Copyright (C) 2013 Matt Sergeant, Hubdoc Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
