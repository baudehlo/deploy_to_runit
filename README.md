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

Next pick a user to use for git pulls. If you're using this for a private
project then create an account with "read only" privileges to your projects in
Github, and create the same account on the machine, setting the home directory
to /var/apps, then create an ssh key for that user and provide it to github.

