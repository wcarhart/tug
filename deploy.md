# Deploying tug with PM2

To deploy tug with [PM2](https://pm2.keymetrics.io/), grab a VM/app instance from your favorite cloud provider and do the following.

First, set up dependencies.
```bash
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
# if you want to run tug on port 80, we need to give Node.js access to the
# restricted port using libcap2
sudo apt-get install libcap2-bin
sudo setcap cap_net_bind_service=+ep `readlink -f \`which node\``
npm install --global pm2@latest
pm2 --version # verify this works
```
Next, install tug. Replace `<username>` with your desired username. This `<username>` is different from the machine's user (`pm2`) and generally arbitrary. Using the default `prefix` of `~/code`, tug expects repositories to be saved in `~/code/<username>/<repository>`. If you're not sure what to use, since tug is owned by [wcarhart](https://github.com/wcarhart), you can use `wcarhart` as the default username for consistency, but this is by no means a requirement.
```bash
mkdir -p code/<username>
cd code/<username>
git clone git@github.com:wcarhart/tug.git
cd tug
yarn install
```
Next, edit tug's `config.json` file to match your desired configuration. Then, verify that the app is working properly. Once you run `yarn prod` you should see tug working at your VM's domain or IP address.
```bash
yarn prod # verify this works, should see app at domain/IP
pm2 start yarn --name <username>/tug -- prod # verify this works, should see app at domain/IP
pm2 startup systemd
# this will spit out another command to run, make sure you run it VERBATIM
pm2 save
sudo reboot
```
After reboot, SSH back into the VM and continue.
```bash
sudo su pm2
cd ~/code/<username>
sudo systemctl start pm2-pm2
pm2 save
```