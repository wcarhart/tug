<p align="center"><img alt="tug logo" src="logo.png" /></p>

<h1 align="center">tug</h1>
<h5 align="center">automagically deploy new Git releases</h5>

## Summary
Tug make it easy to automagically deploy web applications. It was built for Node.js applications but can be used for any web application that uses GitHub.

## How it works
Whenever you publish a new release on GitHub, GitHub can send a webhook to a server (e.g. tug). When tug receives a webhook, it checks GitHub for an updated release and attempts to tug (i.e. pull and sync) the repository. This makes it easy to keep services up-and-running with little extra effort.

## Using tug
Tug deploys code based on its configurations in [config.json](config.json) file. Here are the available options.
| Option | Required | Type | Description | Example |
|:------:|:--------:|:----:|-------------|---------|
|`token`|true|string|Your GitHub API access token, [see here](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) for how to generate one.|`ghp_abc1234`|
|`repositories`|true|array|A list (`username/repository`) of your desired repositories to tug (sync). Each repository will create a route `/:username/:repository` in tug that can be used for registering webhooks.|`wcarhart/tug`|
|`prefix`|false|string|The path prefix where to install your downloaded code (this directory will be created if it does not exist) (default: `$HOME/code`).|`/home/me/mycode`|
|`releases`|false|string|The path where your releases will be downloaded (this directory will be created if it does not exist) (default: `./releases`).|`./myreleases`|
|`reboot`|false|string|A shell command to run after your tug is complete. You can use `$repository` to reference your repository's name in the command.|`pm2 restart $repository`|

## Available endpoints
Use `GET /` to see the available repositories with tug.

Use `GET /status` to see repository statuses.

Use `GET /:username/:repository` to attempt to pull a new update for repository `username/repository`.

## Deploy
Tug is a Node.js app and can be deployed many different ways. Here is how to do it with [PM2](https://pm2.keymetrics.io/).

To deploy tug with PM2, grab a VM/app instance from your favorite cloud provider and do the following (adapted from [my blog](https://willcarh.art/blog/using-pm2-to-deploy-robust-nodejs-apps)).
```bash
# set up dependencies
sudo useradd -m pm2
sudo passwd pm2 # pick strong password, don't check into Git
sudo usermod --shell /bin/bash pm2
sudo usermod -aG sudo pm2
sudo su pm2
cd
sudo apt-get update
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
nvm --version # verify this works
nvm install 15.14.0 # or, pick desired version
npm install --global yarn
sudo apt-get install libcap2-bin
sudo setcap cap_net_bind_service=+ep `readlink -f \`which node\``
npm install --global pm2@latest
pm2 --version # verify this works

# install tug
# replace 'wcarhart' with your username
mkdir -p code/wcarhart
cd code/wcarhart
git clone git@github.com:wcarhart/tug.git
cd tug
yarn install
# copy any necessary .env files to VM
# set up tug config.json as desired
yarn prod # verify this works, should see app at domain/IP
pm2 start yarn --name wcarhart/tug -- prod # verify this works, should see app at domain/IP
pm2 startup systemd
# this will spit out another command to run, make sure you run it VERBATIM
pm2 save
sudo reboot
```
After reboot, SSH back into the VM and continue.
```bash
sudo su pm2
# replace 'wcarhart' with your username
cd ~/code/wcarhart
sudo systemctl start pm2-pm2
pm2 save
```
Then, for each repository you've included in tug's config.json, [create a new webhook](https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks) in GitHub and point it to your VM's IP/domain so tug can receive the requests. **Tug runs on port 42369 by default.**

For example, if I had the repository `wcarhart/tug` in my config.json, I would need my webhook to hit `http://<ip or domain>/wcarhart/tug`.

## FAQ
#### When does tug update code?
Tug attempts to update a repository's code whenever the endpoint `/:user/:repository` is hit. This makes it easy to register webhooks. However, code is only actually pulled when there is a new GitHub release (and Git tag) available.

#### Is tug a good replacement for production CI?
No! It's a simple toy app with a "best effort" in-memory data store and no support for HTTPS. It's great for prototyping quickly, but isn't made for production environments (yet).

#### Why doesn't tug use [webhook secrets](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)?
Tug doesn't actually use the incoming webhook to trigger any new code downloads. When a webhook is received, tug looks at the latest release for the repository on GitHub to determine if it should be downloaded. 

#### How does tug manage queuing?
Tug foregoes external messaging queues like Kafka or RabbitMQ for simplicity and uses an in-memory queue service. The generalized queue service is defined in [queue.mjs](queue.mjs) and the consumer specific to tug's repository functionality is defined in [consumer.mjs](consumer.mjs) and registered in [app.mjs](app.mjs).

#### How does tug compare versions?
Tug uses [compare-versions](https://github.com/omichelsen/compare-versions) to compare Git tags. Tug only supports [Semantic Versioning](https://semver.org/). Using other version schemes can cause tug to malfunction.

#### How does tug manage state?
Repositories adhere to the following state diagram.

```
Initializing -> Idle <-> Checking for updates -> Pulling updates -> Installing updates -> Done -> Idle
                                   ▼                    ▼                     ▼
                                 Error                Error                 Error
```
`Initializing`: Repositories are initializing when there is no queue state defined for them. This only happens once at first app boot. Tug will transition a repository out of this state once a queue event has been produced for this repository.

`Idle`: This is the default state for repositories. This state means nothing is happening and the repository is ready for updates. Tug will transition a repository out of this state when it receives a webhook at `/:username/:repository` (to `Checking for updates`).

`Checking for updates`: This state means that Tug is checking the most recent release list from GitHub to see if it should update code locally. Tug will transition a repository out of this state when it receives a list of releases (to `Pulling updates`) or if it cannot access the repository (to `Error`).

`Pulling updates`: This state means tug is attempting to pull updates from GitHub for the repository. Tug will transition a repository out of this state when it downloads a new update (to `Installing updates`), it determines a previous update was downloaded but not installed (to `Installing updates`), it cannot download updates (to `Error`), or it cannot sort updates based on Git tag (to `Error`).

`Installing updates`: This state means that tug is attempting to install downloaded updates. Tug will transition a repository out of this state when updates have be installed (to `Done`), it can't unpack the downloaded update (to `Error`), it can't copy the unpacked update to the proper location (to `Error`), or it can't run the repository's reboot command (to `Error`).

`Done`: This state means that tug has finished updating the repository's code. Tug will transition a repository out of this state automatically (to `Idle`).
