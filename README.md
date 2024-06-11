# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template


## Architecture

### Assumptions

- Data going through the ingestion system is transient and there is no impact if anything is lost

## TODO

New video stuff
* Stuff from DAMSmart goes straight in
* If we can an H.264 MP4 then use it as the presentation version don't mess with it
* Make sure we deal with 10but encoding appropriately
* May need to adjust something if the incoming colour space is RGB
* ffmpeg -i "$input_file" -c:v libx264 -pix_fmt yuv420p -vf yadif -preset slow -crf 15 -c:a aac "$output_file" https://chatgpt.com/share/afed216b-9cd1-403d-8773-5a6ae9adafeb
