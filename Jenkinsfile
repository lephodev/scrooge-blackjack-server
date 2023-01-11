pipeline {
  agent any
  stages {
    stage('Upload Build') {
          steps {
            sshPublisher(publishers: [sshPublisherDesc(configName: 'scrooge-casino', transfers: [sshTransfer(cleanRemote: false, excludes: '', execCommand: '''rm /home/ubuntu/package.json
cd /home/ubuntu/blackjack-server && git add .
cd /home/ubuntu/blackjack-server && git commit -m "update"
cd /home/ubuntu/blackjack-server && git pull origin main
cd /home/ubuntu/blackjack-server && npm install
pm2 kill
cd /home/ubuntu/landing-server && pm2 start ecosystem.config.json
cd /home/ubuntu/poker-server && pm2 start ecosystem.config.json
cd /home/ubuntu/blackjack-server && pm2 start ecosystem.config.json
cd /home/ubuntu/slot-server && pm2 start ecosystem.config.json''', execTimeout: 120000, flatten: false, makeEmptyDirs: false, noDefaultExcludes: false, patternSeparator: '[, ]+', remoteDirectory: '/', remoteDirectorySDF: false, removePrefix: '', sourceFiles: 'package.json')], usePromotionTimestamp: false, useWorkspaceInPromotion: false, verbose: true)])
            }
        }
  }
}
