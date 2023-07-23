import { Service, PlatformAccessory} from 'homebridge';
import { DreoPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class FanAccessory {
  private service: Service;

  // Cached copy of latest fan states
  private fanState = {
    On: false,
    Speed: 1,
    Swing: false,
    MaxSpeed: 1,
  };

  constructor(
    private readonly platform: DreoPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly state,
    private readonly ws,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, accessory.context.device.brand)
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.sn);

    // initialize fan values
    // get max fan speed from config
    this.fanState.MaxSpeed = accessory.context.device.controlsConf.control[1].items[1].text;
    platform.log.debug('State:', state);
    // load current state from Dreo servers
    this.fanState.On = state.poweron.state;
    this.fanState.Speed = Math.ceil(state.windlevel.state * 100 / this.fanState.MaxSpeed);

    // get the Fanv2 service if it exists, otherwise create a new Fanv2 service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.deviceName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Fanv2
    // register handlers for the Active Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.handleActiveSet.bind(this))
      .onGet(this.handleActiveGet.bind(this));

    // register handlers for the RotationSpeed Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    // check whether fan supports oscillation
    if (state.shakehorizon !== undefined) {
      // register handlers for Swing Mode (oscillation)
      this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onSet(this.setSwingMode.bind(this))
        .onGet(this.getSwingMode.bind(this));
      this.fanState.Swing = state.shakehorizon.state;
    }

    // update values from Dreo app
    ws.addEventListener('message', message => {
      const data = JSON.parse(message.data);

      // check if message applies to this device
      if (data.devicesn === accessory.context.device.sn) {
        platform.log.debug('Incoming %s', message.data);

        // check if we need to update fan state in homekit
        if (data.method === 'control-report' || data.method === 'control-reply' || data.method === 'report') {
          switch(Object.keys(data.reported)[0]) {
            case 'poweron':
              this.fanState.On = data.reported.poweron;
              break;
            case 'windlevel':
              if (data.method === 'report') {
                this.fanState.Speed = Math.ceil(data.reported.windlevel * 100 / this.fanState.MaxSpeed);
              }
              break;
            case 'shakehorizon':
              this.fanState.Swing = data.reported.shakehorizon;
              break;
            default:
              platform.log.debug('Unknown command received:', Object.keys(data.reported)[0]);
          }
        }
      }
    });
  }

  // Handle requests to set the "Active" characteristic
  handleActiveSet(value) {
    this.platform.log.debug('Triggered SET Active:', value);
    // check state to prevent duplicate requests
    if (this.fanState.On !== Boolean(value)) {
      // send to Dreo server via websocket
      this.ws.send(JSON.stringify({
        'devicesn': this.accessory.context.device.sn,
        'method': 'control',
        'params': {'poweron': Boolean(value)},
        'timestamp': Date.now(),
      }));
    }
  }

  // Handle requests to get the current value of the "Active" characteristic
  handleActiveGet() {
    return this.fanState.On;
  }

  // Handle requests to set the fan speed
  async setRotationSpeed(value) {
    // rotation speed needs to be scaled from HomeKit's percentage value (Dreo app uses whole numbers, ex. 1-6)
    const curr = Math.ceil(this.fanState.Speed * this.fanState.MaxSpeed / 100);
    let converted = Math.ceil(value * this.fanState.MaxSpeed / 100);

    if (converted > 10 && converted <= 30){
      converted = 20
    }
    else if (converted > 30 && converted <= 50){
      converted = 40
    }
    else if (converted > 50 && converted <= 70){
      converted = 60
    }
    else if (converted > 70 && converted <= 90){
      converted = 80
    }
    else if (converted > 90 && converted <= 100){
      converted = 100
    }

    // only send if new value is different from original value
    if (curr !== converted) {
      // avoid setting speed to 0 (illegal value)
      if (converted !== 0) {
        this.platform.log.debug('Setting fan speed:', converted);
        this.ws.send(JSON.stringify({
          'devicesn': this.accessory.context.device.sn,
          'method': 'control',
          'params': {
            // setting poweron to true prevents fan speed from being overriden
            'poweron': true,
            'windlevel': converted,
          },
          'timestamp': Date.now(),
        }));
      }
    }
    // save new speed to cache (we only do this for the speed characteristic because it isn't always reported to the server)
    this.fanState.Speed = value;
  }

  async getRotationSpeed() {
    return this.fanState.Speed;
  }

  // turn oscillation on/off
  async setSwingMode(value) {
    this.ws.send(JSON.stringify({
      'devicesn': this.accessory.context.device.sn,
      'method': 'control',
      'params': {'shakehorizon': Boolean(value)},
      'timestamp': Date.now(),
    }));
  }

  async getSwingMode() {
    return this.fanState.Swing;
  }
}
