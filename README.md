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
which are in config/smtp_transport.json, and an email address to receive emails
when new software is deployed. Add the key `email_to` to the file config/main.json.
It can be a comma separated list if you need multiple people to receive deployment
emails.

Now we can check if it will run:

    $ ./run

If it all works, you should see "Now listening on port 10001".

Now we need to get it running as a service. Do this as root:

    # ln -s /var/apps/deploy_to_runit /etc/service/
    # sv status /var/apps/deploy_to_runit/

It should show that deploy_to_runit is running (as is the logger).

Now open up your firewall to the Github webhook IP addresses to port 10001.

Then add in the server as a webhook, and click test while tailing the logs.
