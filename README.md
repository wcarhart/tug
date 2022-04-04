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
|`repositories`|true|array|A list of objects (with required field `name` (`username/repository`), optional fields `ignore`, `reboot`) of your desired repositories to tug (sync).<br><br>Each repository will create a route `/:username/:repository` in tug's API based on the repository's `name` field that can be used for registering webhooks.<br><br>The `ignore` field is an optional list of files to ignore when tug updates the repository. Paths in the `ignore` field are relative to the repository's root, so they don't need to be absolute.<br><br>The `reboot` field is an optional shell command to run after your tug is complete. You can use `$repository` to reference your repository's name in the command.|<pre>[<br>&nbsp;&nbsp;{<br>&nbsp;&nbsp;&nbsp;&nbsp;"name": "wcarhart/tug",<br>&nbsp;&nbsp;&nbsp;&nbsp;"ignore": [<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;".env",<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"secrets/api.cer"<br>&nbsp;&nbsp;&nbsp;&nbsp;],<br>&nbsp;&nbsp;&nbsp;&nbsp;"reboot": "cd ~/code/$repository ; yarn install ; pm2 restart $repository"<br>&nbsp;&nbsp;}<br>]</pre>|
|`prefix`|false|string|The path prefix where to install your downloaded code (this directory will be created if it does not exist) (default: `$HOME/code`).|`/home/me/mycode`|
|`releases`|false|string|The path where your releases will be downloaded (this directory will be created if it does not exist). This path should be relative to tug's project directory (default: `./releases`).|`./myreleases`|

## Available endpoints
Use `GET /` to see the available repositories with tug.

Use `GET /status` to see repository statuses.

Use `POST /:username/:repository` to attempt to pull a new update for repository `username/repository`.

## Example
There is a simple starter [config.json](config.json) included in tug, but it's not comprehensive. Here's a bigger example.
```
{
  "token": "ghp_581433547e278503cd48f3bb88b33ee3",
  "repositories": [
    {
      "name": "username/firstproject",
      "ignore": [ ".env", "secret_key.yaml", "secrets/api.cer" ],
      "reboot": "cd ~/code/$repository ; yarn install ; pm2 restart $repository"
    },
    {
      "name": "username/secondproject",
      "reboot": "cd ~/code/$repository ; pm2 restart $repository"
    },
    {
      "name": "username/thirdproject",
      "ignore": [ "spec.json" ]
    }
  ]
}
```
Using this configuration, tug would create the following directory structure for your deployments, assuming you used the default prefix in your config.json and deployed tug to `~/code/wcarhart/tug`.
```
~
└── code
    ├── username
    │   ├── firstproject
    │   ├── secondproject
    │   └── thirdproject
    └── wcarhart
        └── tug
            ├── queue
            └── releases
                └── username
                    ├── firstproject
                    ├── secondproject
                    └── thirdproject
```
The directory `~/code/username` would be where active services are deployed from. It's similar to where you'd put your code on the machine if you'd deployed it manually. This folder will always contain the latest Git release deployed by tug.

The directory `~/wcarhart/tug` contains the internal details for tug. You don't need to pay much attention to these, as they operate under the hood. If you're interested, tug's `queue` directory tracks the in-memory queue service's backups, in case the app crashes. It is configured to store up to the last 100 events for each repository tracked via tug. Tug's `releases` directory acts as scratch space for downloaded releases from GitHub. Don't worry, tug cleans up old releases and stores everything as tarballs only.

## Deploy
Tug is a Node.js app and can be deployed many different ways.

To play around with the application, use the `dev` Yarn script. First, clone this repository.
```bash
git clone git@github.com:wcarhart/tug.git
```
Then, install depedencies and start a local development server.
```bash
cd tug
yarn install
yarn dev
```
#### Tug runs on port 42369 by default.

For production deploys, there are many different ways to deploy Node.js applications, so your specific use case is up to you. I prefer [PM2](https://pm2.keymetrics.io/). If you'd like a detailed tutorial on how to deploy tug with PM2, see my [PM2 deploy instructions](deploy.md), which were adapted from [my blog](https://willcarh.art/blog/using-pm2-to-deploy-robust-nodejs-apps).

Finally, for each repository you've included in tug's `config.json` file, [create a new webhook](https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks) in GitHub and point it to your tug deployment's IP/domain so tug can receive the requests. **Tug runs on port 42369 by default.** You can change what port tug runs on by setting the environment variable `PORT` or using an `.env` file to do so.

For example, if I had the repository `wcarhart/tug` in my config.json, I would need my webhook to hit `http://<ip or domain>/wcarhart/tug`.

## FAQ
#### When does tug update code?
Tug attempts to update a repository's code whenever the endpoint `/:user/:repository` is hit. This makes it easy to register webhooks. However, code is only actually pulled when there is a new GitHub release (and Git tag) available.

#### Is tug a good replacement for production CI?
No! It's a simple application with an in-memory data store and no support for HTTPS. It's great for prototyping quickly, but isn't made for production environments. If you'd like a lightweight project for managing tug deployments, check out [dock](https://github.com/wcarhart/dock).

#### Why doesn't tug use [webhook secrets](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)?
Tug doesn't actually use the incoming webhook to trigger any new code downloads. When a webhook is received, tug looks at the latest release for the repository on GitHub to determine if it should be downloaded.

#### Why doesn't tug support HTTPS or account management?
Tug is intended to be deployed alongside (i.e. on the same VM as) production services; it's meant to be lightweight. As a result, I've developed another application, [dock](https://github.com/wcarhart/dock), for managing tug deployments. Dock can manage any number of tug servers and comes out of the box with user management (backed by MongoDB), HTTPS + CORS support, and a nice web interface.

#### How does tug manage queuing?
Tug foregoes external messaging queues like Kafka or RabbitMQ for simplicity and uses an in-memory queue service. The generalized queue service is defined in [queue.mjs](queue.mjs) and the consumer specific to tug's repository functionality is defined in [consumer.mjs](consumer.mjs) and registered in [app.mjs](app.mjs).

#### How does tug compare versions?
Tug uses [compare-versions](https://github.com/omichelsen/compare-versions) to compare Git tags. Tug only supports [Semantic Versioning](https://semver.org/). Using other version schemes can cause tug to malfunction.

#### I have an `.env` file on my server that is not checked into Git. Will tug overwrite it? Can I tell tug to ignore it?
Tug performs a clean install based on the release tarball, meaning that _anything not in the Git release (e.g. `.env` files) will not be in the resulting update_. To prevent losing data, you can provide the `ignore` field for each repository in config.json, which is a list of files to ignore while updating code. Note that including files in `ignore` that are not present in the repository will result in an error in tug.

#### I've updated my repository with tug, but now I need to restart the associated service. Can tug do that for me?
Yes! Include the `reboot` command for the repository you'd like to reboot after tug has updated code. The `reboot` command can be any shell command. You can use `$repository` verbatim (e.g. `pm2 restart $repository`) to reference your repository's name in the reboot command.

#### How does tug manage state?
Repositories adhere to the following state diagram. You can see the current repository state via `GET /status`.

```
                                                  Idle
                                                    ▲
Initializing ▶ Idle ▶ Checking for updates ▶ Pulling updates ▶ Installing updates ▶ Done ▶ Idle
                                ▼                   ▼                    ▼
                              Error               Error                Error
```
`Initializing`: Repositories are initializing when there is no queue state defined for them. This only happens once at first app boot. Tug will transition a repository out of this state once a queue event has been produced for this repository.

`Idle`: This is the default state for repositories. This state means nothing is happening and the repository is ready for updates. Tug will transition a repository out of this state when it receives a webhook at `/:username/:repository` (to `Checking for updates`).

`Checking for updates`: This state means that tug is checking the most recent release list from GitHub to see if it should update code locally. Tug will transition a repository out of this state when it receives a list of releases (to `Pulling updates`) or it cannot access the repository's releases (e.g. there are no releases yet) (to `Error`).

`Pulling updates`: This state means tug is attempting to pull updates from GitHub for the repository. Tug will transition a repository out of this state when it downloads a new update (to `Installing updates`), it determines a previous update was downloaded but not installed (to `Installing updates`), it determines no new update is available (to `Idle`), it cannot download updates (to `Error`), or it cannot sort updates based on Git tag (to `Error`).

`Installing updates`: This state means that tug is attempting to install downloaded updates. Tug will transition a repository out of this state when updates have be installed (to `Done`), it can't unpack the downloaded update (to `Error`), it can't copy the unpacked update to the proper location (to `Error`), or it can't run the repository's reboot command (to `Error`).

`Done`: This state means that tug has finished updating the repository's code. Tug will transition a repository out of this state automatically (to `Idle`).
