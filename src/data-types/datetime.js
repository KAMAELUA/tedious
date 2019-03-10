const DateTimeN = require('./datetimen');

const THREE_AND_A_THIRD = 3 + (1 / 3);
const EPOCH_DATE = new Date(1900, 0, 1);
const UTC_EPOCH_DATE = new Date(Date.UTC(1900, 0, 1));

module.exports = {
  id: 0x3D,
  type: 'DATETIME',
  name: 'DateTime',

  fromBuffer(buffer, offset, { useUTC }) {
    const days = buffer.readUInt32LE(offset);
    const threeHundredthsOfSecond = buffer.readUInt32LE(offset + 4);
    const milliseconds = Math.round(threeHundredthsOfSecond * THREE_AND_A_THIRD);

    let value;
    if (useUTC) {
      value = new Date(Date.UTC(1900, 0, 1 + days, 0, 0, 0, milliseconds));
    } else {
      value = new Date(1900, 0, 1 + days, 0, 0, 0, milliseconds);
    }

    return value;
  },

  declaration: function() {
    return 'datetime';
  },

  writeTypeInfo: function(buffer) {
    buffer.writeUInt8(DateTimeN.id);
    buffer.writeUInt8(8);
  },

  writeParameterData: function(buffer, parameter, options) {
    if (parameter.value != null) {
      let days, dstDiff, milliseconds, seconds, threeHundredthsOfSecond;
      if (options.useUTC) {
        days = Math.floor((parameter.value.getTime() - UTC_EPOCH_DATE.getTime()) / (1000 * 60 * 60 * 24));
        seconds = parameter.value.getUTCHours() * 60 * 60;
        seconds += parameter.value.getUTCMinutes() * 60;
        seconds += parameter.value.getUTCSeconds();
        milliseconds = (seconds * 1000) + parameter.value.getUTCMilliseconds();
      } else {
        dstDiff = -(parameter.value.getTimezoneOffset() - EPOCH_DATE.getTimezoneOffset()) * 60 * 1000;
        days = Math.floor((parameter.value.getTime() - EPOCH_DATE.getTime() + dstDiff) / (1000 * 60 * 60 * 24));
        seconds = parameter.value.getHours() * 60 * 60;
        seconds += parameter.value.getMinutes() * 60;
        seconds += parameter.value.getSeconds();
        milliseconds = (seconds * 1000) + parameter.value.getMilliseconds();
      }

      threeHundredthsOfSecond = milliseconds / (3 + (1 / 3));
      threeHundredthsOfSecond = Math.round(threeHundredthsOfSecond);

      buffer.writeUInt8(8);
      buffer.writeInt32LE(days);

      buffer.writeUInt32LE(threeHundredthsOfSecond);
    } else {
      buffer.writeUInt8(0);
    }
  },

  validate: function(value) {
    if (value == null) {
      return null;
    }
    if (!(value instanceof Date)) {
      value = Date.parse(value);
    }
    if (isNaN(value)) {
      return new TypeError('Invalid date.');
    }
    return value;
  }
};
